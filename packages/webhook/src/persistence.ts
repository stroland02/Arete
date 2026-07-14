import type { ScmProvider } from '@arete/db'
import { prisma } from './db.js'
import type { ReviewResult, TelemetrySnapshot } from './types.js'

const MAX_PROJECT_MEMORIES = 20

export interface ReviewExistsParams {
  provider: ScmProvider
  /** GitHub repository id, or GitLab project id. Unique per provider only. */
  repositoryExternalId: number
  prNumber: number
  headSha: string
}

/**
 * Cheap early idempotency check used by the webhook handlers BEFORE
 * enqueueing a review job: if a Review already exists for this exact
 * (repository, prNumber, headSha), a duplicate webhook delivery (GitHub does
 * retry) would otherwise still burn a full LLM pipeline run before hitting
 * persistReview()'s own DB-level idempotency check at the end. This lets
 * callers skip enqueueing entirely instead.
 *
 * Only needs the repository/PR/headSha triple, which the webhook payload
 * itself provides — no diff fetch or LLM call required to make this check.
 */
export async function reviewExists(params: ReviewExistsParams): Promise<boolean> {
  const { provider, repositoryExternalId, prNumber, headSha } = params

  const repository = await prisma.repository.findUnique({
    where: { provider_externalId: { provider, externalId: repositoryExternalId } },
  })
  if (!repository) return false

  const existing = await prisma.review.findUnique({
    where: {
      repositoryId_prNumber_headSha: { repositoryId: repository.id, prNumber, headSha },
    },
  })
  return existing !== null
}

export interface PersistInstallationParams {
  provider: ScmProvider
  /** GitHub App installation id, or GitLab project id. Unique per provider only. */
  installationExternalId: number
  /** Account the app was installed on (org login, or the user's own login). */
  owner: string
}

/**
 * Upserts an Installation row the moment the app is installed (from the GitHub
 * `installation` webhook), so a freshly-installed account enters the dashboard's
 * tenancy scope IMMEDIATELY — before any PR has been reviewed. Without this, the
 * only place an Installation row was ever created was persistReview() on a first
 * completed review, so a brand-new customer saw an empty dashboard until then.
 *
 * Keyed on the provider-scoped @@unique([provider, externalId]); idempotent on a
 * re-delivered webhook (GitHub retries). Returns the installation's stable id.
 */
export async function persistInstallation(params: PersistInstallationParams): Promise<string> {
  const { provider, installationExternalId, owner } = params
  const installation = await prisma.installation.upsert({
    where: { provider_externalId: { provider, externalId: installationExternalId } },
    create: { provider, externalId: installationExternalId, owner },
    update: { owner },
  })
  return installation.id
}

export interface PersistReviewParams {
  provider: ScmProvider
  /** GitHub App installation id, or GitLab project id. Unique per provider only. */
  installationExternalId: number
  /** GitHub repository id, or GitLab project id. Unique per provider only. */
  repositoryExternalId: number
  owner: string
  name: string
  fullName: string
  prNumber: number
  headSha: string
  result: ReviewResult
}

/**
 * Persists the Installation -> Repository -> Review chain for a completed
 * review and increments the installation's usage counter.
 *
 * - Rows are looked up by the provider-scoped @@unique([provider, externalId])
 *   constraint; primary keys stay Prisma-generated UUIDs.
 * - Idempotent on @@unique([repositoryId, prNumber, headSha]): a re-delivered
 *   webhook for the same head SHA is skipped instead of duplicating the row
 *   (and does not count against usage).
 *
 * Callers must treat failures here as non-fatal: the review has already been
 * posted to the SCM by the time persistence runs, and persistence must never
 * block the review itself.
 */
export async function persistReview(params: PersistReviewParams): Promise<void> {
  const {
    provider,
    installationExternalId,
    repositoryExternalId,
    owner,
    name,
    fullName,
    prNumber,
    headSha,
    result,
  } = params

  const installation = await prisma.installation.upsert({
    where: { provider_externalId: { provider, externalId: installationExternalId } },
    create: { provider, externalId: installationExternalId, owner },
    update: { owner },
  })

  const repository = await prisma.repository.upsert({
    where: { provider_externalId: { provider, externalId: repositoryExternalId } },
    create: {
      provider,
      externalId: repositoryExternalId,
      name,
      fullName,
      installationId: installation.id,
    },
    update: { name, fullName },
  })

  const existing = await prisma.review.findUnique({
    where: {
      repositoryId_prNumber_headSha: { repositoryId: repository.id, prNumber, headSha },
    },
  })
  if (existing) {
    console.log(
      `[persistence] Review for ${fullName}#${prNumber} @ ${headSha} already exists — skipping duplicate`
    )
    return
  }

  await prisma.review.create({
    data: {
      prNumber,
      repositoryId: repository.id,
      riskLevel: result.risk_level,
      overallSummary: result.overall_summary,
      headSha,
      analysisStatus: result.analysis_status ?? 'complete',
      comments: {
        createMany: {
          data: result.file_reviews.flatMap((fr) =>
            fr.comments.map((c) => ({
              path: fr.path,
              line: c.line,
              body: c.body,
              severity: c.severity,
              category: c.category,
            }))
          ),
        },
      },
    },
  })

  await prisma.installation.update({
    where: { id: installation.id },
    data: { usageCount: { increment: 1 } },
  })
}

export interface PersistTelemetrySnapshotsParams {
  provider: ScmProvider
  /** GitHub App installation id, or GitLab project id. Unique per provider only. */
  installationExternalId: number
  snapshots: TelemetrySnapshot[]
}

/**
 * Upserts the latest telemetry snapshot per (installation, provider,
 * sourceRef) — a "what did we see as of the last review" record, NOT a
 * growing history table (see TelemetrySnapshotRecord's schema comment).
 * Backs the dashboard's Master Grid page.
 *
 * Requires the Installation row to already exist — callers should run this
 * after persistReview (which upserts it) in the same job, not before.
 * Silently no-ops if the installation isn't found yet, matching
 * persistReview's non-fatal contract: telemetry persistence must never
 * block or fail a review that already posted successfully.
 */
export async function persistTelemetrySnapshots(params: PersistTelemetrySnapshotsParams): Promise<void> {
  const { provider, installationExternalId, snapshots } = params
  if (snapshots.length === 0) return

  const installation = await prisma.installation.findUnique({
    where: { provider_externalId: { provider, externalId: installationExternalId } },
  })
  if (!installation) return

  await Promise.all(
    snapshots.map((s) =>
      prisma.telemetrySnapshotRecord.upsert({
        where: {
          installationId_provider_sourceRef: {
            installationId: installation.id,
            provider: s.provider,
            sourceRef: s.source_ref,
          },
        },
        create: {
          installationId: installation.id,
          provider: s.provider,
          sourceRef: s.source_ref,
          summaryText: s.summary_text,
          metrics: s.metrics,
          links: s.links,
          fetchedAt: new Date(s.fetched_at),
        },
        update: {
          summaryText: s.summary_text,
          metrics: s.metrics,
          links: s.links,
          fetchedAt: new Date(s.fetched_at),
        },
      })
    )
  )
}

/**
 * Fetches up to MAX_PROJECT_MEMORIES active AgentMemory bodies for a repo,
 * most recently created first. Returns [] if no Repository row exists yet
 * for this (provider, externalId) pair — a repo with no prior review can't
 * have any AgentMemory rows (the FK requires a repositoryId) — or if the
 * repo simply has no active memories saved. Never throws for either case;
 * callers attach the result directly to PRContext.projectMemories, which
 * agents/base.py already treats as optional.
 */
export async function fetchProjectMemories(
  provider: ScmProvider,
  repositoryExternalId: number
): Promise<string[]> {
  const repository = await prisma.repository.findUnique({
    where: { provider_externalId: { provider, externalId: repositoryExternalId } },
  })
  if (!repository) return []

  const memories = await prisma.agentMemory.findMany({
    where: { repositoryId: repository.id, status: 'active' },
    orderBy: { createdAt: 'desc' },
    take: MAX_PROJECT_MEMORIES,
  })
  return memories.map((m: { body: string }) => m.body)
}
