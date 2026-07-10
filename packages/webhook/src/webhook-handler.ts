import type { Octokit } from '@octokit/core'
import { fetchPRContext } from './pr-fetcher.js'
import { runReviewPipeline } from './review-bridge.js'
import { postReview } from './comment-poster.js'

const HANDLED_ACTIONS = new Set(['opened', 'synchronize', 'reopened'])

interface PullRequestPayload {
  action: string
  repository: { owner: { login: string }; name: string }
  pull_request: { number: number }
}

export async function handlePullRequestEvent(
  octokit: Octokit,
  payload: PullRequestPayload
): Promise<void> {
  if (!HANDLED_ACTIONS.has(payload.action)) {
    console.log(`[handler] Ignoring pull_request.${payload.action}`)
    return
  }

  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const prNumber = payload.pull_request.number

  console.log(`[handler] Reviewing ${owner}/${repo}#${prNumber} (${payload.action})`)

  const prContext = await fetchPRContext(octokit, owner, repo, prNumber)
  const result = await runReviewPipeline(prContext)
  await postReview(octokit, owner, repo, prNumber, result)

  console.log(`[handler] Posted review — risk: ${result.risk_level}, comments: ${result.total_comments}`)
}
