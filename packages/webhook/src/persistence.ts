import type { ScmProvider } from '@arete/db'
import { prisma } from './db.js'
import type { ReviewResult } from './types.js'

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
