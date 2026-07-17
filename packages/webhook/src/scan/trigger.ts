// Auto-scan trigger: the single entry point that decides whether a repo scan
// may start for a tenant and, when it may, runs it end-to-end against the
// agents /scan endpoint and lands the findings in the work-item inbox.
//
// Gating (the spec's "a scan cannot think without a model"): a scan starts only
// when the installation has BOTH a connected repository AND a resolvable
// ModelConnection (the same decrypted `llm` block /review uses — BYO model,
// never a raw env key). A scan already `running` for the tenant blocks a second
// one (the route maps that to 409). Every execution is recorded as a ScanRun
// with an honest terminal status: complete / no_findings / failed(+error) —
// never a partial inbox presented as complete.
//
// Dedup: findings upsert on (installationId, fingerprint) where the fingerprint
// is sha256(installationId + dimension + sorted evidence paths). Only an
// existing `open` item is refreshed; dismissed/fixing/staged/posted items are
// left untouched — a dismissal is a decision and is never resurrected.

import { createHash } from 'node:crypto'
import {
  resolveModelConnectionForReview,
  defaultResolveModelDeps,
  type LlmConfig,
} from '../resolve-model-connection.js'

export interface ScanFindingBody {
  kind: 'issue' | 'opportunity'
  title: string
  detail: string
  evidence: { path: string; line: number; excerpt?: string | null }[]
  dimension: string
  confidence: number
}

/** Wire contract with agents POST /scan (Task 5). */
export interface ScanRequestBody {
  installationId: number
  repoSlug: string
  llm: LlmConfig
}

export interface ScanResponseBody {
  status: 'complete' | 'no_findings'
  findings: ScanFindingBody[]
}

export interface ScanTriggerResult {
  started: boolean
  reason?: 'no_model' | 'no_repo' | 'already_running'
}

export interface ScanTriggerDeps {
  prisma: {
    installation: {
      findUnique(args: unknown): Promise<{ id: string; externalId: number } | null>
    }
    repository: {
      findFirst(args: unknown): Promise<{ id: string; fullName: string } | null>
    }
    scanRun: {
      findFirst(args: unknown): Promise<{ id: string } | null>
      create(args: unknown): Promise<{ id: string }>
      update(args: unknown): Promise<unknown>
    }
    workItem: {
      findUnique(args: unknown): Promise<{ id: string; state: string } | null>
      create(args: unknown): Promise<unknown>
      update(args: unknown): Promise<unknown>
    }
  }
  resolveModel(externalInstallationId: number): Promise<LlmConfig | undefined>
  fetchScan(body: ScanRequestBody): Promise<ScanResponseBody>
}

/** Dedup key: sha256 of installationId + dimension + sorted evidence paths.
 *  Shared with the review-findings sync so a re-scan and a review land on the
 *  same key for the same evidence. */
export function computeFingerprint(
  installationId: string,
  dimension: string,
  evidencePaths: string[],
): string {
  return createHash('sha256')
    .update(`${installationId}:${dimension}:${[...evidencePaths].sort().join(',')}`)
    .digest('hex')
}

export async function maybeStartScan(
  installationId: string,
  deps: ScanTriggerDeps = defaultScanTriggerDeps(),
): Promise<ScanTriggerResult> {
  const installation = await deps.prisma.installation.findUnique({
    where: { id: installationId },
    select: { id: true, externalId: true },
  })
  if (!installation) return { started: false, reason: 'no_repo' }

  const repo = await deps.prisma.repository.findFirst({
    where: { installationId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, fullName: true },
  })
  if (!repo) return { started: false, reason: 'no_repo' }

  const llm = await deps.resolveModel(installation.externalId)
  if (!llm) return { started: false, reason: 'no_model' }

  const running = await deps.prisma.scanRun.findFirst({
    where: { installationId, status: 'running' },
    select: { id: true },
  })
  if (running) return { started: false, reason: 'already_running' }

  const run = await deps.prisma.scanRun.create({
    data: { installationId, repositoryId: repo.id, status: 'running' },
  })

  try {
    const response = await deps.fetchScan({
      installationId: installation.externalId,
      repoSlug: repo.fullName,
      llm,
    })

    for (const finding of response.findings) {
      const fingerprint = computeFingerprint(
        installationId,
        finding.dimension,
        finding.evidence.map((e) => e.path),
      )
      const existing = await deps.prisma.workItem.findUnique({
        where: { installationId_fingerprint: { installationId, fingerprint } },
        select: { id: true, state: true },
      })
      if (!existing) {
        await deps.prisma.workItem.create({
          data: {
            installationId,
            kind: finding.kind,
            source: 'scan',
            title: finding.title,
            detail: finding.detail,
            evidence: finding.evidence,
            dimension: finding.dimension,
            confidence: finding.confidence,
            state: 'open',
            fingerprint,
            scanRunId: run.id,
          },
        })
      } else if (existing.state === 'open') {
        // Refresh only what a re-scan legitimately re-derives; state is
        // untouched and non-open items (dismissed/fixing/staged/posted) are
        // skipped entirely above.
        await deps.prisma.workItem.update({
          where: { id: existing.id },
          data: {
            title: finding.title,
            detail: finding.detail,
            confidence: finding.confidence,
            scanRunId: run.id,
          },
        })
      }
    }

    await deps.prisma.scanRun.update({
      where: { id: run.id },
      data: {
        status: response.findings.length > 0 ? 'complete' : 'no_findings',
        finishedAt: new Date(),
      },
    })
  } catch (err) {
    // Honest failure: the run is marked failed with the reason; the caller
    // still learns the scan started. Never rethrow — a scan must not take
    // down its trigger path (webhook handler / connect route).
    const message = err instanceof Error ? err.message : String(err)
    try {
      await deps.prisma.scanRun.update({
        where: { id: run.id },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      })
    } catch (updateErr) {
      console.error('[scan-trigger] failed to record ScanRun failure:', updateErr)
    }
  }

  return { started: true }
}

/** Real deps: @arete/db Prisma client, the shared BYO-model resolver, and the
 *  agents service /scan endpoint. Imported lazily so registering the route
 *  never pulls in @arete/db (same pattern as the staging send seam). */
export function defaultScanTriggerDeps(): ScanTriggerDeps {
  const delegate = <T>(name: string, method: string) =>
    async (args: unknown): Promise<T> => {
      const { prisma } = await import('../db.js')
      return (prisma as any)[name][method](args)
    }
  return {
    prisma: {
      installation: { findUnique: delegate('installation', 'findUnique') },
      repository: { findFirst: delegate('repository', 'findFirst') },
      scanRun: {
        findFirst: delegate('scanRun', 'findFirst'),
        create: delegate('scanRun', 'create'),
        update: delegate('scanRun', 'update'),
      },
      workItem: {
        findUnique: delegate('workItem', 'findUnique'),
        create: delegate('workItem', 'create'),
        update: delegate('workItem', 'update'),
      },
    },
    resolveModel: (externalId) =>
      resolveModelConnectionForReview(externalId, defaultResolveModelDeps()),
    fetchScan: async (body) => {
      const { getServiceConfig } = await import('../config.js')
      const res = await fetch(`${getServiceConfig().pythonServiceUrl}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`agents /scan responded ${res.status}: ${text}`)
      }
      return (await res.json()) as ScanResponseBody
    },
  }
}
