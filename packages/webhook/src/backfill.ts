import type { Octokit } from '@octokit/core'
import { enqueueReviewJob } from './queue.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'backfill' })

/**
 * Minimal shape Kuma needs out of a GitHub `repository` object as delivered
 * on `installation.repositories` / `installation_repositories.repositories_added`.
 */
export interface BackfillRepo {
  id: number
  name: string
  full_name: string
}

// GitHub returns PRs in pages of up to 100. A long-lived repo can easily have
// more open PRs than that, so this must paginate the same way
// pr-fetcher.ts's listAllFiles does for changed files.
async function listOpenPullRequests(octokit: Octokit, owner: string, repo: string): Promise<any[]> {
  const all: any[] = []
  let page = 1
  while (true) {
    const { data } = await (octokit as any).rest.pulls.list({
      owner,
      repo,
      state: 'open',
      per_page: 100,
      page,
    })
    all.push(...data)
    if (data.length < 100) break
    page += 1
  }
  return all
}

/**
 * Backfills a single repo's currently-open PRs into the review-pr queue,
 * mapping fields the SAME way handlePullRequestEvent (webhook-handler.ts)
 * does for a live `pull_request` event.
 *
 * Best-effort at both levels: a repo whose PR list fails to load is skipped
 * (logged, not thrown), and a single PR that fails to enqueue does not stop
 * the rest of that repo's PRs from being tried. This function is called from
 * the `installation`/`installation_repositories` webhook handlers, which
 * must return quickly and must never let one bad repo/PR sour the whole
 * install.
 *
 * Idempotency is NOT re-checked here: `enqueueReviewJob` -> worker.ts ->
 * persistReview() already no-ops on the existing
 * @@unique([repositoryId, prNumber, headSha]) constraint, so a re-delivered
 * `installation` webhook (GitHub does retry) just re-enqueues jobs that
 * finish as cheap no-ops instead of duplicating reviews. Adding a
 * reviewExists() pre-check here would only duplicate that guard.
 *
 * Note: unlike the live `pull_request` event, GitHub's `pulls.list` response
 * does not include `changed_files` (only the single-PR `pulls.get` does), so
 * every backfilled PR maps to the 'fast' lane regardless of its actual size.
 */
export async function backfillInstallationPRs(
  octokit: Octokit,
  installationId: number,
  repos: BackfillRepo[]
): Promise<void> {
  for (const repo of repos) {
    const owner = repo.full_name.split('/')[0] ?? ''
    const name = repo.name

    let prs: any[]
    try {
      prs = await listOpenPullRequests(octokit, owner, name)
    } catch (err) {
      log.error({ err, repo: repo.full_name }, 'Failed to list open PRs — skipping repo')
      continue
    }

    if (prs.length === 0) {
      log.info({ repo: repo.full_name }, 'No open PRs to backfill')
      continue
    }

    for (const pr of prs) {
      try {
        const changedFiles = pr.changed_files ?? 0
        const lane = changedFiles > 50 ? 'heavy' : 'fast'

        await enqueueReviewJob({
          provider: 'github',
          kind: 'pull_request',
          owner,
          repo: name,
          repositoryExternalId: repo.id,
          fullName: repo.full_name,
          installationId,
          prNumber: pr.number,
          headSha: pr.head.sha,
        }, lane)

        log.info({ repo: repo.full_name, prNumber: pr.number, lane }, 'Enqueued review-pr job (backfill)')
      } catch (err) {
        log.error({ err, repo: repo.full_name, prNumber: pr.number }, 'Failed to enqueue backfill job')
      }
    }
  }
}
