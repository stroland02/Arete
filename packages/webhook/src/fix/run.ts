// The healing-loop fix run (spec 2026-07-19 §2–§4): consume one fix-workitem
// job, call agents POST /fix (frozen §3 wire contract), and advance the
// IssueContainer through REAL state transitions — persisting state + transcript
// on each one, so the stream route replays honest progress. Success parks the
// container at `ready` (HITL moat: the human approve/send gates are untouched);
// any failure is terminal `fix_failed` with the WorkItem honestly back at
// `open` + fixError. Never throws: a fix run's outcome is always recorded, and
// a BullMQ retry of a recorded failure would re-run a whole LLM fix for free.

import type { LlmConfig } from '../resolve-model-connection.js'

export const FIX_TIMEOUT_MS = 300_000

export interface FixEvidenceRef {
  path: string
  line: number
  excerpt?: string | null
}

/** Frozen §3 request. camelCase on the wire; repo.token is webhook-minted,
 *  rides only this server-to-server call, and is never logged or persisted. */
export interface FixRequestBody {
  containerId: string
  installationId: string
  repo: { fullName: string; defaultBranch: string; token: string }
  item: {
    kind: string
    title: string
    detail: string
    dimension: string
    confidence: number
    evidence: FixEvidenceRef[]
  }
  llm: LlmConfig
}

export interface FixTranscriptEntry {
  agent: string
  action: 'author' | 'verify' | 'compose'
  detail: string
  report?: { status: 'done' | 'blocked'; confidence: number; blockers: string[] }
}

/** Frozen §3 response. patch non-empty iff status === "fixed". */
export interface FixResponseBody {
  status: 'fixed' | 'fix_failed'
  reason?: string
  patch: { path: string; content: string }[]
  transcript: FixTranscriptEntry[]
  verification?: { verdict: 'verified' | 'unverified'; checks: string[] }
}

/** SynthStep-shaped transcript record. The dashboard's types.ts is out of
 *  package — this is the same JSON shape, structurally, per spec §4. */
interface StepRecord {
  kind: 'dispatch' | 'report' | 'verify' | 'compose' | 'drop' | 'posted'
  agentId?: string
  text: string
  detail?: string
  at: string
  report?: unknown
}

export interface FixRunDeps {
  prisma: {
    workItem: {
      findUnique(args: unknown): Promise<{
        id: string
        installationId: string
        kind: string
        title: string
        detail: string
        dimension: string
        confidence: number
        evidence: unknown
        state: string
        containerId: string | null
      } | null>
      update(args: unknown): Promise<unknown>
    }
    issueContainer: {
      findFirst(args: unknown): Promise<{ id: string; state: string; pr: unknown } | null>
      updateMany(args: unknown): Promise<{ count: number }>
    }
    installation: { findUnique(args: unknown): Promise<{ id: string; externalId: number } | null> }
    repository: { findFirst(args: unknown): Promise<{ fullName: string } | null> }
  }
  resolveModel(externalInstallationId: number): Promise<LlmConfig | undefined>
  mintToken(externalInstallationId: number): Promise<string>
  fetchFix(body: FixRequestBody): Promise<FixResponseBody>
  now?: () => string
}

export async function runFixJob(
  data: { workItemId: string },
  deps: FixRunDeps = defaultFixRunDeps(),
): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString())

  const item = await deps.prisma.workItem.findUnique({ where: { id: data.workItemId } })
  // Stale/forged job — the row moved on. Nothing honest to record.
  if (!item || item.state !== 'fixing' || !item.containerId) return

  const containerId = item.containerId
  const installationId = item.installationId
  const steps: StepRecord[] = []

  const persist = (state: string, extra: Record<string, unknown> = {}) =>
    deps.prisma.issueContainer.updateMany({
      where: { id: containerId, installationId },
      data: { state, transcript: steps, ...extra },
    })

  const fail = async (reason: string) => {
    steps.push({ kind: 'drop', text: 'Fix failed', detail: reason, at: now() })
    await persist('fix_failed')
    await deps.prisma.workItem.update({
      where: { id: item.id },
      data: { state: 'open', fixError: reason },
    })
  }

  try {
    const container = await deps.prisma.issueContainer.findFirst({
      where: { id: containerId, installationId },
    })
    if (!container) {
      await fail('fix run could not load its container')
      return
    }
    const installation = await deps.prisma.installation.findUnique({
      where: { id: installationId },
      select: { id: true, externalId: true },
    })
    const repo = await deps.prisma.repository.findFirst({
      where: { installationId },
      orderBy: { createdAt: 'asc' },
      select: { fullName: true },
    })
    if (!installation || !repo) {
      await fail('no connected repository for this fix')
      return
    }
    const llm = await deps.resolveModel(installation.externalId)
    if (!llm) {
      await fail('no connected model — connect one and retry')
      return
    }

    steps.push({
      kind: 'dispatch',
      text: 'Fix author dispatched',
      detail: `${item.dimension} · ${item.title}`,
      at: now(),
    })
    await persist('fanning_out')

    const token = await deps.mintToken(installation.externalId)
    const pr = (container.pr ?? {}) as { base?: string }
    const response = await deps.fetchFix({
      containerId,
      installationId,
      repo: { fullName: repo.fullName, defaultBranch: pr.base ?? 'main', token },
      item: {
        kind: item.kind,
        title: item.title,
        detail: item.detail,
        dimension: item.dimension,
        confidence: item.confidence,
        evidence: (Array.isArray(item.evidence) ? item.evidence : []) as FixEvidenceRef[],
      },
      llm,
    })

    // The agents transcript rides into ours — real per-stage reports, never
    // synthesized. author → report (provenance = the authoring agent).
    for (const t of response.transcript ?? []) {
      const kind = t.action === 'verify' ? 'verify' : t.action === 'compose' ? 'compose' : 'report'
      steps.push({
        kind,
        agentId: t.agent,
        text: t.detail,
        at: now(),
        ...(t.report ? { report: t.report } : {}),
      })
    }
    await persist('verifying')

    // Deterministic double-check of the §3 grounding contract ("patch
    // non-empty iff fixed") — a violating response is a failure, never staged.
    if (response.status !== 'fixed' || !Array.isArray(response.patch) || response.patch.length === 0) {
      await fail(response.reason ?? 'fix author returned no verified patch')
      return
    }

    steps.push({
      kind: 'compose',
      text: `Patch composed — ${response.patch.length} file${response.patch.length === 1 ? '' : 's'}`,
      at: now(),
    })
    await persist('composing', { patch: response.patch })

    steps.push({ kind: 'posted', text: 'Fix staged — ready for your approval', at: now() })
    await persist('ready')
    // WorkItem stays `fixing` — the human approve hook moves it to `staged`.
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'AbortError'
        ? 'timeout'
        : 'fix run failed — the fix service was unreachable or errored'
    console.error(`[fix-worker] run for work item ${data.workItemId} failed:`, err)
    try {
      await fail(reason)
    } catch (persistErr) {
      console.error(`[fix-worker] could not record failure for ${data.workItemId}:`, persistErr)
    }
  }
}

/** Real deps: @arete/db Prisma client, the shared BYO-model resolver, the App
 *  installation token minter, and the agents /fix endpoint with the §3 300s
 *  budget. Imported lazily so importing this module never pulls in @arete/db
 *  (same pattern as scan/trigger.ts). */
export function defaultFixRunDeps(): FixRunDeps {
  const db = () => import('../db.js').then((m) => m.prisma)
  return {
    prisma: {
      workItem: {
        findUnique: async (args) => (await db()).workItem.findUnique(args as never),
        update: async (args) => (await db()).workItem.update(args as never),
      },
      issueContainer: {
        findFirst: async (args) => (await db()).issueContainer.findFirst(args as never),
        updateMany: async (args) => (await db()).issueContainer.updateMany(args as never),
      },
      installation: {
        findUnique: async (args) => (await db()).installation.findUnique(args as never),
      },
      repository: {
        findFirst: async (args) => (await db()).repository.findFirst(args as never),
      },
    },
    async resolveModel(externalInstallationId) {
      const { resolveModelConnectionForReview, defaultResolveModelDeps } = await import(
        '../resolve-model-connection.js'
      )
      return resolveModelConnectionForReview(externalInstallationId, defaultResolveModelDeps())
    },
    async mintToken(externalInstallationId) {
      const { createApp, getInstallationToken } = await import('../github-auth.js')
      return getInstallationToken(createApp(), externalInstallationId)
    },
    async fetchFix(body) {
      const { getServiceConfig } = await import('../config.js')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FIX_TIMEOUT_MS)
      try {
        const res = await fetch(`${getServiceConfig().pythonServiceUrl}/fix`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`/fix returned ${res.status}`)
        return (await res.json()) as FixResponseBody
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
