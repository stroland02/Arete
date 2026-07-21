// Internal memory write-back (Phase 2 Task 8) — closes the add_project_memory
// stub in packages/agents/src/arete_agents/tools/memory.py. Today that tool
// logs and returns a hardcoded success string without persisting anything —
// an agent is TOLD the write succeeded when nothing was written. This module
// is the ONE real write path that call reaches, mounted behind the shared
// internal-token guard (server.ts `/internal` mount) the same as every other
// service-to-service surface (/scan/trigger, /staging/send, /fix/trigger).
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
// Size cap (spec §3 "size-capped"): body length and total ACTIVE rows per
// repository are both capped. A breach is REJECTED with a clear reason, never
// silently truncated. The row cap reuses persistence.ts's MAX_PROJECT_MEMORIES
// so the write cap and the read cap (fetchProjectMemories, which takes the 20
// most recent) can never drift apart — there is no point ever storing more
// active rows than the read path will ever surface.
//
// Honest failure (the defect being removed): every failure path returns
// `{ ok: false, reason }`, including an unexpected DB rejection — this
// function must NEVER throw a raw error out to the route, and must never
// report `ok: true` without an actual persisted row.

import { trace, metrics, SpanStatusCode, type Counter } from '@opentelemetry/api'
import { prisma } from './db.js'
import { logger } from './logger.js'
import { MAX_PROJECT_MEMORIES } from './persistence.js'

const log = logger.child({ component: 'memory' })
const tracer = trace.getTracer('arete-webhook')

/** Mirrors packages/agents/src/arete_agents/tools/memory.py's _MAX_NOTE_CHARS
 *  comment — kept in sync manually, both sides document the other. */
export const MAX_MEMORY_BODY_CHARS = 4000

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
  | 'cap_exceeded'
  | 'internal_error'

export type SaveMemoryResult =
  | { ok: true; id: string }
  | { ok: false; reason: SaveMemoryReason; detail?: string }

export async function saveAgentMemory(params: SaveMemoryParams): Promise<SaveMemoryResult> {
  return tracer.startActiveSpan('memory.write', async (span) => {
    try {
      const result = await saveInner(params)
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
  const title = (params.title && params.title.trim()) || body.slice(0, 80).trim() || 'Rule'

  if (
    !Number.isFinite(installationExternalId) ||
    !repoFullName ||
    typeof body !== 'string' ||
    !body.trim()
  ) {
    return { ok: false, reason: 'invalid_input' }
  }

  // Reject, never truncate (spec §3) — a silently-truncated rule can quietly
  // change its own meaning.
  if (body.length > MAX_MEMORY_BODY_CHARS) {
    return {
      ok: false,
      reason: 'body_too_long',
      detail: `body is ${body.length} chars; max is ${MAX_MEMORY_BODY_CHARS}`,
    }
  }

  let installation: { id: string } | null
  let repository: { id: string } | null
  let activeCount: number
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

    activeCount = await prisma.agentMemory.count({
      where: { repositoryId: repository.id, status: 'active' },
    })
  } catch (err) {
    log.error({ err }, 'failed to resolve tenant for agent memory write')
    return { ok: false, reason: 'internal_error' }
  }

  if (activeCount >= MAX_MEMORIES_PER_REPO) {
    return {
      ok: false,
      reason: 'cap_exceeded',
      detail: `repository already has ${activeCount} active memories (max ${MAX_MEMORIES_PER_REPO})`,
    }
  }

  try {
    const created = await prisma.agentMemory.create({
      data: { repositoryId: repository.id, kind, title, body },
      select: { id: true },
    })
    return { ok: true, id: created.id }
  } catch (err) {
    // The exact failure mode the stub used to hide: a real write failure
    // (constraint violation, DB unreachable, etc.) must come back as an
    // honest rejection, never a fabricated success.
    log.error({ err }, 'failed to persist agent memory')
    return { ok: false, reason: 'internal_error' }
  }
}
