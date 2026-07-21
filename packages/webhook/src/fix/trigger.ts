// Fix drive: the healing-loop dispatcher (Wave B — Eng4 lane).
//
// The dashboard's "Fix it"/"Implement it" creates an IssueContainer at
// `detecting` and fires POST /fix/trigger with the work item's id. This module
// runs the drive end-to-end (mirroring scan/trigger.ts's inline shape, not the
// review BullMQ queue): it resolves the tenant's connected repo + model, mints a
// short-lived installation token, calls the agents POST /fix author+verify
// pipeline, and advances the stored container through its real states —
//   detecting → fanning_out → (agents authors+verifies) → ready   (patch attached)
//   …or any pre-ready stage → fix_failed                           (WorkItem → open)
// persisting a real transcript at each write so the console replays honest steps.
//
// It NEVER crosses the HITL gate: a successful drive rests at `ready` and waits
// for the human approve → send. It never fabricates a patch: agents returns
// `fixed` only with a verified, grounded patch, and this driver refuses to
// advance to `ready` unless that patch is non-empty.

import type { App } from '@octokit/app'
import { SpanStatusCode, type Span } from '@opentelemetry/api'
import {
  resolveModelConnectionForReview,
  defaultResolveModelDeps,
  type LlmConfig,
} from '../resolve-model-connection.js'
import { logger } from '../logger.js'
import { internalAuthHeaders } from '../internal-auth.js'
import { runWithFixSpan, withChildSpan } from '../observability.js'

const log = logger.child({ component: 'fix' })

const REVIEW_DIMENSIONS = new Set([
  'security',
  'performance',
  'quality',
  'test_coverage',
  'deployment_safety',
  'business_logic',
])

/** agents FixPatchFile — path + COMPLETE new file content (staged verbatim). */
export interface FixPatchFile {
  path: string
  content: string
}

interface FixTranscriptReport {
  status: string // "done" | "blocked"
  confidence?: number | null
  blockers?: string[]
}
interface FixTranscriptStep {
  agent: string
  action: string // "author" | "verify" | "compose"
  detail: string
  report?: FixTranscriptReport
}

/** Wire contract with agents POST /fix (healing-loop spec §3). */
export interface FixRequestBody {
  containerId: string
  installationId: number // NUMERIC external id (see models/fix.py docstring)
  repo: { fullName: string; defaultBranch: string; token: string }
  item: {
    kind: string
    title: string
    detail: string
    dimension: string
    confidence: number
    evidence: { path: string; line: number; excerpt?: string | null }[]
  }
  llm: LlmConfig
}

export interface FixResponseBody {
  status: 'fixed' | 'fix_failed'
  reason?: string | null
  patch: FixPatchFile[]
  transcript?: FixTranscriptStep[]
  verification?: { verdict: string; checks: string[] } | null
}

export interface FixDriveResult {
  ok: boolean
  status?: 'fixed' | 'fix_failed'
  reason?: 'not_found' | 'no_repo' | 'no_model' | 'no_container' | 'cooldown'
  /** Populated when reason === 'cooldown' (queue-consumer.ts). */
  retryAfterSeconds?: number
}

export interface FixTriggerDeps {
  prisma: {
    workItem: {
      findUnique(args: unknown): Promise<{
        id: string
        installationId: string
        containerId: string | null
        kind: string
        title: string
        detail: string
        dimension: string
        confidence: number
        evidence: unknown
        fixFailureCount: number
      } | null>
      update(args: unknown): Promise<unknown>
    }
    installation: {
      findUnique(args: unknown): Promise<{ id: string; externalId: number } | null>
    }
    repository: {
      findFirst(args: unknown): Promise<{ id: string; fullName: string } | null>
    }
    issueContainer: {
      findUnique(args: unknown): Promise<{ id: string; state: string } | null>
      update(args: unknown): Promise<unknown>
    }
  }
  resolveModel(externalInstallationId: number): Promise<LlmConfig | undefined>
  mintToken(externalInstallationId: number): Promise<string>
  fetchFix(body: FixRequestBody): Promise<FixResponseBody>
}

interface SynthStepJson {
  kind: string
  text: string
  at: string
  agentId?: string
  detail?: string
  report?: {
    agent: string
    dimension: string
    status: string
    summary: string
    confidence: number
    blockers: string[]
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Map agents transcript → the dashboard SynthStep JSON the console replays.
 *  A `report` is attached only when the item's dimension is one Kuma models,
 *  so the status board never renders a fabricated dimension. */
function mapTranscript(steps: FixTranscriptStep[] | undefined, dimension: string): SynthStepJson[] {
  if (!steps) return []
  const at = nowIso()
  return steps.map((s) => {
    const kind = s.action === 'author' ? 'dispatch' : s.action === 'verify' ? 'verify' : 'compose'
    const step: SynthStepJson = { kind, text: s.detail, at, agentId: s.agent }
    if (s.report && REVIEW_DIMENSIONS.has(dimension)) {
      step.report = {
        agent: s.agent,
        dimension,
        status: s.report.status,
        summary: s.detail,
        confidence: typeof s.report.confidence === 'number' ? s.report.confidence : 0,
        blockers: s.report.blockers ?? [],
      }
    }
    return step
  })
}

/**
 * Drive one work item's fix to a terminal container state. Never throws — every
 * failure path lands the container in `fix_failed` and returns the WorkItem to
 * `open` (retryable via "Fix it"), the reason preserved in the transcript.
 *
 * Wrapped in the webhook-side `fix.run` root span (see observability.ts's doc
 * comment for why it deliberately shares its name with the Python fix
 * pipeline's own root span) so the whole drive — repo/installation/model
 * resolution, token minting, the HTTP call into agents, and the container
 * writes — is one connected trace running from the BullMQ consumer hop
 * (queue-consumer.ts) through to the Python `fix.run` tree.
 */
export async function driveFix(
  workItemId: string,
  deps: FixTriggerDeps,
): Promise<FixDriveResult> {
  return runWithFixSpan({ workItemId }, (span) => driveFixInner(workItemId, deps, span))
}

async function driveFixInner(
  workItemId: string,
  deps: FixTriggerDeps,
  span: Span,
): Promise<FixDriveResult> {
  const item = await deps.prisma.workItem.findUnique({
    where: { id: workItemId },
    select: {
      id: true,
      installationId: true,
      containerId: true,
      kind: true,
      title: true,
      detail: true,
      dimension: true,
      confidence: true,
      evidence: true,
      fixFailureCount: true,
    },
  })
  if (!item) {
    span.setAttribute('arete.fix.outcome', 'error')
    span.setAttribute('arete.fix.reason', 'not_found')
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'not_found' })
    return { ok: false, reason: 'not_found' }
  }
  span.setAttribute('arete.fix.dimension', item.dimension)
  if (!item.containerId) {
    span.setAttribute('arete.fix.outcome', 'error')
    span.setAttribute('arete.fix.reason', 'no_container')
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'no_container' })
    return { ok: false, reason: 'no_container' }
  }
  const containerId = item.containerId
  span.setAttribute('arete.container.id', containerId)

  // Idempotent terminate: a container that already settled at a terminal
  // state (ready / fix_failed) must not be re-driven — no re-write, no
  // re-emitted outcome. This guards a drive that runs twice for the same
  // work item (e.g. a duplicate enqueue, or a job processed after the
  // cooldown check already let a second attempt through the queue) from
  // double-writing state or double-counting a failure.
  const currentContainer = await deps.prisma.issueContainer.findUnique({
    where: { id: containerId },
    select: { id: true, state: true },
  })
  if (currentContainer && (currentContainer.state === 'ready' || currentContainer.state === 'fix_failed')) {
    log.info(
      { containerId, state: currentContainer.state },
      'fix drive already terminal — skipping (idempotent terminate)',
    )
    span.setAttribute('arete.fix.outcome', currentContainer.state)
    span.setAttribute('arete.fix.idempotent_skip', true)
    span.setStatus({ code: SpanStatusCode.OK })
    return { ok: true, status: currentContainer.state === 'ready' ? 'fixed' : 'fix_failed' }
  }

  const fail = async (reason: string, priorSteps: SynthStepJson[] = []): Promise<FixDriveResult> => {
    span.setAttribute('arete.fix.outcome', 'fix_failed')
    span.setAttribute('arete.fix.reason', reason)
    span.setStatus({ code: SpanStatusCode.ERROR, message: reason })
    const transcript = [...priorSteps, { kind: 'drop', text: `Fix failed — ${reason}`, at: nowIso() }]
    await withChildSpan('fix.container.settle', async () => {
      try {
        await deps.prisma.issueContainer.update({
          where: { id: containerId },
          data: { state: 'fix_failed', transcript },
        })
        // Return the item to the inbox so the human can retry (scan-failure
        // UX), and bump the cooldown bookkeeping in the SAME write so the
        // count and its timestamp stay atomic with the state flip (Task 6).
        await deps.prisma.workItem.update({
          where: { id: item.id },
          data: { state: 'open', fixFailureCount: { increment: 1 }, fixFailureAt: new Date() },
        })
      } catch (err) {
        log.error({ err, containerId }, 'failed to record fix_failed')
      }
    })
    return { ok: true, status: 'fix_failed' }
  }

  // repo/installation/model-connection resolution, grouped under one child
  // span — mirrors review.context.build's grouping of several fetches.
  const resolved = await withChildSpan('fix.resolve', async () => {
    const installation = await deps.prisma.installation.findUnique({
      where: { id: item.installationId },
      select: { id: true, externalId: true },
    })
    if (!installation) return { ok: false as const, reason: 'installation not found' }

    const repo = await deps.prisma.repository.findFirst({
      where: { installationId: item.installationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullName: true },
    })
    if (!repo) return { ok: false as const, reason: 'no connected repository' }

    const llm = await deps.resolveModel(installation.externalId)
    if (!llm) return { ok: false as const, reason: 'no AI model connected — connect one to run fixes' }

    return { ok: true as const, installation, repo, llm }
  })
  if (!resolved.ok) return fail(resolved.reason)
  const { installation, repo, llm } = resolved
  span.setAttribute('arete.installation.id', installation.externalId)
  span.setAttribute('arete.repo.full_name', repo.fullName)

  let token: string
  try {
    token = await withChildSpan('fix.token.mint', () => deps.mintToken(installation.externalId))
  } catch (err) {
    return fail(`could not authenticate to the repository: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Advance detecting → fanning_out and persist the authoring step.
  const authoring: SynthStepJson[] = [
    { kind: 'dispatch', text: `Authoring a fix on ${llm.model ?? llm.provider}`, at: nowIso() },
  ]
  await withChildSpan('fix.container.advance', async () => {
    try {
      await deps.prisma.issueContainer.update({
        where: { id: containerId },
        data: { state: 'fanning_out', transcript: authoring },
      })
    } catch (err) {
      log.error({ err, containerId }, 'failed to advance to fanning_out')
    }
  })

  const evidence = Array.isArray(item.evidence)
    ? (item.evidence as { path: string; line: number; excerpt?: string | null }[])
    : []

  let resp: FixResponseBody
  try {
    // The HTTP call into agents' /fix. No explicit HTTP-client span here —
    // `fetch` rides the service-wide auto-instrumentation (same as
    // review-bridge.ts's plain `fetch` to /review), which propagates W3C
    // trace headers so the Python fix.run pipeline span (Task 14) nests as
    // this span's descendant, joining this one trace.
    resp = await withChildSpan('fix.agents.call', () =>
      deps.fetchFix({
        containerId,
        installationId: installation.externalId,
        repo: { fullName: repo.fullName, defaultBranch: 'main', token },
        item: {
          kind: item.kind,
          title: item.title,
          detail: item.detail,
          dimension: item.dimension,
          confidence: item.confidence,
          evidence,
        },
        llm,
      })
    )
  } catch (err) {
    return fail(`fix service error: ${err instanceof Error ? err.message : String(err)}`, authoring)
  }

  const driveSteps = [...authoring, ...mapTranscript(resp.transcript, item.dimension)]

  // Honest gate: `fixed` MUST carry a non-empty patch, or it is a failure —
  // the driver never advances to `ready` with an empty diff (spec §3).
  if (resp.status === 'fixed' && resp.patch.length > 0) {
    const transcript = [
      ...driveSteps,
      { kind: 'compose', text: `Composed patch — ${resp.patch.length} file(s)`, at: nowIso() },
    ]
    let persisted = true
    await withChildSpan('fix.container.settle', async () => {
      try {
        await deps.prisma.issueContainer.update({
          where: { id: containerId },
          data: { state: 'ready', patch: resp.patch, transcript },
        })
      } catch (err) {
        log.error({ err, containerId }, 'failed to mark ready')
        persisted = false
        return
      }
      // WorkItem stays `fixing` — it now awaits the human approve → send. A
      // successful run DOES clear the cooldown accumulated by prior failures
      // (Task 6 requirement 4: a cooldown that only ever grows would eventually
      // lock out a work item that started succeeding). Only written when there
      // is something to clear, so the common first-try-succeeds path stays a
      // single container write with no WorkItem touch, matching the existing
      // HITL-moat contract (no *state* change on success).
      if (item.fixFailureCount > 0) {
        try {
          await deps.prisma.workItem.update({
            where: { id: item.id },
            data: { fixFailureCount: 0, fixFailureAt: null },
          })
        } catch (err) {
          log.error({ err, workItemId: item.id }, 'failed to clear fix cooldown after a successful drive')
        }
      }
    })
    if (!persisted) return fail('could not persist the composed patch', driveSteps)
    span.setAttribute('arete.fix.outcome', 'fixed')
    span.setStatus({ code: SpanStatusCode.OK })
    return { ok: true, status: 'fixed' }
  }

  return fail(resp.reason ?? 'no verified patch was produced', driveSteps)
}

/** Real deps: @arete/db, the shared BYO-model resolver, the App token minter,
 *  and the agents /fix endpoint. Imported lazily so route registration never
 *  pulls in @arete/db (same pattern as scan/trigger + the staging seam). */
export function defaultFixTriggerDeps(app: App): FixTriggerDeps {
  const delegate =
    <T>(name: string, method: string) =>
    async (args: unknown): Promise<T> => {
      const { prisma } = await import('../db.js')
      return (prisma as any)[name][method](args)
    }
  return {
    prisma: {
      workItem: {
        findUnique: delegate('workItem', 'findUnique'),
        update: delegate('workItem', 'update'),
      },
      installation: { findUnique: delegate('installation', 'findUnique') },
      repository: { findFirst: delegate('repository', 'findFirst') },
      issueContainer: {
        findUnique: delegate('issueContainer', 'findUnique'),
        update: delegate('issueContainer', 'update'),
      },
    },
    resolveModel: (externalId) =>
      resolveModelConnectionForReview(externalId, defaultResolveModelDeps()),
    mintToken: async (externalId) => {
      const { getInstallationToken } = await import('../github-auth.js')
      return getInstallationToken(app, externalId)
    },
    fetchFix: async (body) => {
      const { getServiceConfig } = await import('../config.js')
      const res = await fetch(`${getServiceConfig().pythonServiceUrl}/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`agents /fix responded ${res.status}: ${text}`)
      }
      return (await res.json()) as FixResponseBody
    },
  }
}
