// Review → inbox sync: after a PR review's comments persist, its substantive
// findings (severity error/warning — info is advice, not work) land in the
// work-item inbox as kind:"pr_finding", source:"review" WorkItems.
//
// Dedup uses the SAME fingerprint scheme as the repo scan (sha256 of
// installationId + dimension + sorted evidence paths, see trigger.ts), so a
// finding surfaced by both a review and a scan resolves to one inbox item.
// Only an existing `open` item is refreshed; dismissed/fixing/staged/posted
// items are never touched — a dismissal is a decision.
//
// Confidence is REAL or honestly absent: when the review carries a stored
// confidence it is used verbatim; otherwise 0.5 with the detail explicitly
// noting the finding is unscored. Never synthesized.

import { computeFingerprint } from './trigger.js'

export interface ReviewFindingComment {
  path: string
  line: number
  body: string
  category: string
  severity: string
  /** Stored review confidence, when the pipeline produced one. */
  confidence?: number
}

export interface ReviewSyncDeps {
  prisma: {
    workItem: {
      findUnique(args: unknown): Promise<{ id: string; state: string } | null>
      create(args: unknown): Promise<unknown>
      update(args: unknown): Promise<unknown>
    }
  }
}

/** First line of the comment body as the inbox subject line. */
function titleOf(body: string): string {
  const firstLine = body.split('\n', 1)[0]?.trim() ?? ''
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine
}

export async function syncReviewFindings(
  installationId: string,
  reviewId: string,
  comments: ReviewFindingComment[],
  deps: ReviewSyncDeps = defaultReviewSyncDeps(),
): Promise<number> {
  let created = 0
  for (const c of comments) {
    if (c.severity !== 'error' && c.severity !== 'warning') continue

    const fingerprint = computeFingerprint(installationId, c.category, [c.path])
    const confidence = typeof c.confidence === 'number' ? c.confidence : 0.5
    const detail =
      typeof c.confidence === 'number'
        ? c.body
        : `${c.body}\n\n(confidence unscored by this review — defaulted to 0.5)`

    const existing = await deps.prisma.workItem.findUnique({
      where: { installationId_fingerprint: { installationId, fingerprint } },
      select: { id: true, state: true },
    })
    if (!existing) {
      await deps.prisma.workItem.create({
        data: {
          installationId,
          kind: 'pr_finding',
          source: 'review',
          title: titleOf(c.body),
          detail,
          evidence: [{ path: c.path, line: c.line }],
          dimension: c.category,
          confidence,
          state: 'open',
          fingerprint,
        },
      })
      created += 1
    } else if (existing.state === 'open') {
      await deps.prisma.workItem.update({
        where: { id: existing.id },
        data: { title: titleOf(c.body), detail, confidence },
      })
    }
  }
  return created
}

/** Real deps: the @arete/db client, imported lazily so the review path stays
 *  import-cheap and the sync is unit-testable without a DB. */
export function defaultReviewSyncDeps(): ReviewSyncDeps {
  const delegate = <T>(method: 'findUnique' | 'create' | 'update') =>
    async (args: unknown): Promise<T> => {
      const { prisma } = await import('../db.js')
      return (prisma.workItem as any)[method](args)
    }
  return {
    prisma: {
      workItem: {
        findUnique: delegate('findUnique'),
        create: delegate('create'),
        update: delegate('update'),
      },
    },
  }
}
