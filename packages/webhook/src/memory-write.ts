// Internal memory write-back (Phase 2 Task 8) — closes the add_project_memory
// stub in packages/agents/src/arete_agents/tools/memory.py. Today that tool
// logs and returns a hardcoded success string without persisting anything —
// an agent is TOLD the write succeeded when nothing was written. This module
// is the ONE real write path that call reaches, mounted behind the shared
// internal-token guard (server.ts `/internal` mount) the same as every other
// service-to-service surface (/scan/trigger, /staging/send, /fix/trigger).
//
// "THE ONE real write path" is literal, and is now enforced rather than
// merely asserted: `saveAgentMemory` is the only caller of
// `prisma.agentMemory.create` in this package. chat-handler.ts used to open a
// second, weaker one (repo resolved by fullName alone, no tenant scoping, no
// caps, no redaction — review finding B6) and now goes through here too. A
// future sink that wants to persist a memory calls this function; if it
// cannot, that is a signal the guard needs extending, not bypassing.
//
// Tenant guard (Global Constraint 4): the caller supplies the GitHub App's
// numeric installation id (the same identity PRContext.installation_id
// already carries end-to-end) and a repo full name. The repository is
// resolved SCOPED to that installation —
// `prisma.repository.findFirst({ installationId, fullName })` — the exact
// pattern context-map/file-content.ts's defaultFileContentDeps() already uses
// to resolve a tenant's own repo. A repo that exists but belongs to a
// DIFFERENT installation is indistinguishable from one that doesn't exist at
// all ('repo_not_found') — never leak which is true, matching that module's
// not_found posture. This makes a cross-tenant write structurally impossible
// rather than merely application-checked: there is no code path from an
// (installationExternalId, repoFullName) pair to a repositoryId outside that
// installation's own rows.
//
// Size cap (spec §3 "size-capped"): body and title length are capped, and a
// breach is REJECTED with a clear reason, never silently truncated.
//
// Row cap — FIFO, not a wall. Total ACTIVE rows per repository are capped at
// persistence.ts's MAX_PROJECT_MEMORIES, shared with the read path
// (fetchProjectMemories, which takes the 20 most recent) so write and read can
// never drift apart. When a repo is AT the cap, the OLDEST active row is
// ARCHIVED (`status: 'archived'` — retained, never deleted) to make room for
// the new one.
//
// This used to be a hard `cap_exceeded` rejection, and that was the defect:
// nothing in the entire codebase ever set `status='archived'`, so a repo that
// reached 20 active rows stopped learning PERMANENTLY — its memory set froze at
// whatever it happened to know first, and every later write failed forever,
// silently, for the life of the repo. Archiving the oldest is exactly what the
// read path already implies (it only ever surfaces the 20 most recent), so this
// makes storage agree with what the model actually sees rather than inventing a
// new policy.
//
// The count, the archive and the create run in ONE serializable transaction.
// The cap used to be check-then-create with no transaction and no DB
// constraint, so N concurrent writes for one repo could all observe
// `count == 19` and all insert — the cap was advisory. Serializable makes it
// enforced.
//
// Honest failure (the defect being removed): every failure path returns
// `{ ok: false, reason }`, including an unexpected DB rejection — this
// function must NEVER throw a raw error out to the route, and must never
// report `ok: true` without an actual persisted row.

import { trace, metrics, SpanStatusCode, type Counter } from '@opentelemetry/api'
import { scrubSinkText } from '@arete/telemetry'
import { prisma } from './db.js'
import { logger } from './logger.js'
import { MAX_PROJECT_MEMORIES } from './persistence.js'

const log = logger.child({ component: 'memory' })
const tracer = trace.getTracer('arete-webhook')

/** Mirrors packages/agents/src/arete_agents/tools/memory.py's _MAX_NOTE_CHARS
 *  comment — kept in sync manually, both sides document the other. */
export const MAX_MEMORY_BODY_CHARS = 4000

/** Server-side cap on `title` (Phase 2 review finding B2). The cap used to
 *  exist on `body` ONLY, so an 80,000-char title returned 201 over real HTTP
 *  and stored all 80,000 — the Python tool's `note[:80]` truncation was the
 *  only bound, and a client-side-only bound is exactly what this task exists
 *  to remove. Comfortably above the 80 chars tools/memory.py actually sends,
 *  so a well-behaved client can never trip it. */
export const MAX_MEMORY_TITLE_CHARS = 200

/** Reuses persistence.ts's read-side cap (see module header) rather than
 *  introducing a second, potentially-drifting constant. */
export const MAX_MEMORIES_PER_REPO = MAX_PROJECT_MEMORIES

const ALLOWED_KINDS = new Set(['feedback', 'terminology', 'infra', 'project'])

let writesCounter: Counter | null = null
/** `arete.memory.writes` — closed dims only (Global Constraint 1): outcome. */
function memoryWritesMetric(): Counter {
  if (!writesCounter) {
    const meter = metrics.getMeter('arete-webhook')
    writesCounter = meter.createCounter('arete.memory.writes', {
      description: 'AgentMemory write attempts, by outcome',
    })
  }
  return writesCounter
}

export interface SaveMemoryParams {
  /** GitHub App installation id (the caller's own tenant identity). */
  installationExternalId: number
  /** owner/repo — the repo the memory is scoped to. */
  repoFullName: string
  kind?: string
  title?: string
  body: string
}

export type SaveMemoryReason =
  | 'invalid_input'
  | 'repo_not_found'
  | 'body_too_long'
  | 'title_too_long'
  | 'cap_exceeded'
  | 'internal_error'

export type SaveMemoryResult =
  | { ok: true; id: string }
  | { ok: false; reason: SaveMemoryReason; detail?: string }

export async function saveAgentMemory(params: SaveMemoryParams): Promise<SaveMemoryResult> {
  // The callback's return type is annotated, not inferred. Without it, tsc
  // widens the union across the try/catch arms to `{ ok: boolean; reason:
  // string }`, which is not assignable to SaveMemoryResult — and the whole
  // point of that discriminated union is that `ok: false` always carries a
  // known SaveMemoryReason, so a caller can never mistake a failure for a
  // success.
  return tracer.startActiveSpan('memory.write', async (span): Promise<SaveMemoryResult> => {
    // Tenant ids belong on SPANS, never on metric dimensions (Global
    // Constraint 1) — the `arete.memory.writes` counter below stays
    // outcome-only. Without these a failed write was unattributable in Jaeger:
    // you could see that *a* write was rejected, but not whose.
    span.setAttribute('arete.installation.id', String(params.installationExternalId))
    span.setAttribute('arete.repo.full_name', String(params.repoFullName))
    try {
      const result = await saveInner(params)
      // `reason` is the same closed set the metric uses, so it is safe as an
      // attribute and is the one thing you actually need to debug a rejection.
      span.setAttribute('arete.memory.reason', result.ok ? 'saved' : result.reason)
      memoryWritesMetric().add(1, { outcome: result.ok ? 'saved' : result.reason })
      span.setStatus({ code: result.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR })
      return result
    } catch (err) {
      // Belt-and-suspenders: saveInner already turns its own DB errors into
      // { ok: false, reason: 'internal_error' } (see below), but nothing here
      // may ever escape as a thrown error — a caller must always get an
      // honest result object, never an exception that could be mistaken for
      // (or accidentally mapped to) success.
      log.error({ err }, 'unexpected error saving agent memory')
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.setStatus({ code: SpanStatusCode.ERROR })
      span.setAttribute('arete.memory.reason', 'internal_error')
      memoryWritesMetric().add(1, { outcome: 'internal_error' })
      return { ok: false, reason: 'internal_error' }
    } finally {
      span.end()
    }
  })
}

async function saveInner(params: SaveMemoryParams): Promise<SaveMemoryResult> {
  const { installationExternalId, repoFullName, body } = params
  const kind = params.kind && ALLOWED_KINDS.has(params.kind) ? params.kind : 'project'

  // VALIDATE FIRST, derive second. This ordering used to be inverted: the
  // `body.slice(0, 80)` title fallback ran BEFORE the `typeof body !==
  // 'string'` check below, so a non-string body threw inside saveInner and
  // came back as `internal_error` (500) when it is plainly a 400
  // `invalid_input`. Nothing may read `body`/`title` as strings above here.
  if (
    !Number.isFinite(installationExternalId) ||
    typeof repoFullName !== 'string' ||
    !repoFullName ||
    typeof body !== 'string' ||
    !body.trim() ||
    (params.title != null && typeof params.title !== 'string')
  ) {
    return { ok: false, reason: 'invalid_input' }
  }

  const rawTitle = (params.title && params.title.trim()) || body.slice(0, 80).trim() || 'Rule'

  // REDACT FIRST, cap the REDACTED (stored) value (review finding N2). These
  // used to be reject-never-truncate caps on the RAW input, on the theory
  // that "what is bounded is what the caller actually sent." That theory was
  // wrong: scrubbing can LENGTHEN a string (`?token=a` -> `?token=[REDACTED]`,
  // 8 chars -> 17), so a raw-input cap does not bound what ends up in the
  // database — a reviewer probe stored a 3,996-char raw body at 7,992 stored
  // chars, ~2x the documented bound. The bound that actually matters is on
  // the STORED string: `fetchProjectMemories` re-injects these rows into
  // EVERY future review prompt for the repo (base.py), so it is the
  // persisted size — a context-budget and cost concern, not just a storage
  // one — that must be capped, not the size of whatever text the caller
  // happened to type before redaction touched it. Scrubbing here (once) also
  // means `saveInner` below persists these same strings directly instead of
  // re-scrubbing at create time.
  const scrubbedBody = scrubSinkText(body)
  const scrubbedTitle = scrubSinkText(rawTitle)

  if (scrubbedBody.length > MAX_MEMORY_BODY_CHARS) {
    return {
      ok: false,
      reason: 'body_too_long',
      detail: `body is ${scrubbedBody.length} chars after redaction; max is ${MAX_MEMORY_BODY_CHARS}`,
    }
  }

  // The SAME reject-never-truncate rule on `title` (review finding B2), now
  // measured the same post-redaction way as `body` above.
  if (scrubbedTitle.length > MAX_MEMORY_TITLE_CHARS) {
    return {
      ok: false,
      reason: 'title_too_long',
      detail: `title is ${scrubbedTitle.length} chars after redaction; max is ${MAX_MEMORY_TITLE_CHARS}`,
    }
  }

  let installation: { id: string } | null
  let repository: { id: string } | null
  try {
    installation = await prisma.installation.findUnique({
      where: { provider_externalId: { provider: 'github', externalId: installationExternalId } },
      select: { id: true },
    })
    if (!installation) return { ok: false, reason: 'repo_not_found' }

    // TENANT GUARD: the repo is looked up SCOPED to this installation's own
    // id. A repo belonging to another installation simply never matches this
    // query — there is no separate "is this mine?" check to forget or bypass.
    repository = await prisma.repository.findFirst({
      where: { installationId: installation.id, fullName: repoFullName },
      select: { id: true },
    })
    if (!repository) return { ok: false, reason: 'repo_not_found' }
  } catch (err) {
    log.error({ err }, 'failed to resolve tenant for agent memory write')
    return { ok: false, reason: 'internal_error' }
  }

  const repositoryId = repository.id

  // Misconfiguration guard, and the ONLY surviving `cap_exceeded` case. With a
  // cap below 1 there is no room to archive INTO — storing one row would mean
  // archiving the entire set to hold it — so the write is honestly refused
  // rather than silently destroying every memory the repo has.
  if (MAX_MEMORIES_PER_REPO < 1) {
    return {
      ok: false,
      reason: 'cap_exceeded',
      detail: `memory cap is configured to ${MAX_MEMORIES_PER_REPO}; no memory can be stored`,
    }
  }

  try {
    // REDACTION (Global Constraint 2, review finding B1). `title` and `body`
    // are model-authored free text derived from a PR's diff and description —
    // attacker-adjacent by construction — and an AgentMemory row is a
    // persistence sink whose contents fetchProjectMemories re-injects into
    // EVERY later review prompt for this repo (base.py). An unscrubbed secret
    // here is therefore amplified to the model provider on every subsequent
    // review, not merely stored once. Both columns went through the canonical
    // @arete/telemetry sink scrubber above (the same call the sibling
    // alerting sink makes for every persisted field, alerting/receiver.ts) —
    // never a bespoke one — and are persisted as-is here: `scrubSinkText` is
    // idempotent, so re-scrubbing at this point would be redundant, not safer.
    //
    // Count → archive-oldest → create, in ONE serializable transaction. All
    // three must be atomic: counting outside the transaction is exactly the
    // check-then-create race that made the cap advisory, and archiving outside
    // it could retire a memory for a write that then fails.
    const { created, archived } = await prisma.$transaction(
      async (tx) => {
        const activeCount = await tx.agentMemory.count({
          where: { repositoryId, status: 'active' },
        })

        // How many must retire so this row fits WITHIN the cap, not at it.
        // Normally 0 or 1; >1 only if a pre-existing overshoot (from the old
        // racy path) is being drained, which this quietly repairs.
        const mustArchive = activeCount - MAX_MEMORIES_PER_REPO + 1
        let archivedCount = 0
        if (mustArchive > 0) {
          const oldest = await tx.agentMemory.findMany({
            where: { repositoryId, status: 'active' },
            orderBy: { createdAt: 'asc' },
            take: mustArchive,
            select: { id: true },
          })
          if (oldest.length > 0) {
            const result = await tx.agentMemory.updateMany({
              where: { id: { in: oldest.map((m) => m.id) } },
              // ARCHIVED, never deleted: the row stays queryable for anyone who
              // later wants to see what this repo used to know.
              data: { status: 'archived' },
            })
            archivedCount = result.count
          }
        }

        const row = await tx.agentMemory.create({
          data: {
            repositoryId,
            kind,
            title: scrubbedTitle,
            body: scrubbedBody,
          },
          select: { id: true },
        })
        return { created: row, archived: archivedCount }
      },
      { isolationLevel: 'Serializable' },
    )

    if (archived > 0) {
      // Never a silent eviction: a memory leaving the active set is a real
      // change to what the model will see on every future review of this repo.
      log.info(
        { repositoryId, archived, cap: MAX_MEMORIES_PER_REPO },
        'archived oldest agent memories to make room for a new one',
      )
      trace.getActiveSpan()?.setAttribute('arete.memory.archived', archived)
    }

    return { ok: true, id: created.id }
  } catch (err) {
    // The exact failure mode the stub used to hide: a real write failure
    // (constraint violation, DB unreachable, etc.) must come back as an
    // honest rejection, never a fabricated success.
    log.error({ err }, 'failed to persist agent memory')
    return { ok: false, reason: 'internal_error' }
  }
}
