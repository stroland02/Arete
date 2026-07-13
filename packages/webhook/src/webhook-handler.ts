import type { Octokit } from '@octokit/core'
import { prisma } from './db.js'
import { reviewExists } from './persistence.js'
import { enqueueReviewJob } from './queue.js'
import { ARETE_CHECK_RUN_NAME } from './constants.js'
import { evaluateBillingGate } from './billing.js'

const HANDLED_ACTIONS = new Set(['opened', 'synchronize', 'reopened'])

interface PullRequestPayload {
  action: string
  repository: {
    id: number
    owner: { login: string }
    name: string
    full_name: string
  }
  pull_request: { number: number, head: { sha: string }, changed_files?: number }
  installation?: { id: number }
}

/**
 * GitHub webhook handler for `pull_request` events.
 *
 * This must return quickly: GitHub expects webhook deliveries to complete in
 * ~10 seconds and will mark a slow delivery failed (and may retry it, which
 * is why the early idempotency check below matters). The actual review
 * pipeline (fetch diff -> LLM review -> post comment -> persist) can take
 * minutes, so it never runs in this function — it's handed off to the
 * `review-pr` queue and picked up by worker.ts in a separate process.
 */
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
  const headSha = payload.pull_request.head.sha
  const installationId = payload.installation?.id

  console.log(`[handler] Received pull_request.${payload.action} for ${owner}/${repo}#${prNumber}`)

  if (installationId) {
    const installation = await prisma.installation.findUnique({
      where: { provider_externalId: { provider: 'github', externalId: installationId } }
    })

    // Billing gate — runs BEFORE the idempotency check and BEFORE enqueueing,
    // so a blocked installation never spends an LLM pipeline run. Covers both
    // a lapsed subscription (canceled/past_due) and an exhausted free tier
    // (50 free reviews, no active paid subscription).
    const gate = evaluateBillingGate(installation)
    if (!gate.allowed) {
      console.log(
        `[handler] Review blocked for installation ${installationId} (${gate.reason}). ` +
        `Status: ${installation?.subscriptionStatus}, usage: ${installation?.usageCount}`
      )
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner,
        repo,
        issue_number: prNumber,
        body: gate.message
      })
      return
    }
  }

  // Early idempotency: a re-delivered webhook (GitHub does retry) for a head
  // SHA that already has a completed review would otherwise still enqueue —
  // and pay for — a full LLM pipeline run before persistReview()'s DB-level
  // check catches the duplicate at the very end. The PR's head SHA is
  // already on the payload, so this check is a single cheap lookup with no
  // diff fetch or API call required.
  const alreadyReviewed = await reviewExists({
    provider: 'github',
    repositoryExternalId: payload.repository.id,
    prNumber,
    headSha,
  })
  if (alreadyReviewed) {
    console.log(
      `[handler] Review already exists for ${owner}/${repo}#${prNumber} @ ${headSha} — skipping duplicate delivery`
    )
    return
  }

  if (!installationId) {
    console.warn(
      `[handler] No installation id on payload for ${owner}/${repo}#${prNumber} — cannot enqueue review job`
    )
    return
  }

  // Dual-Lane Ingestion Queuing
  // Route massive PRs to a separate 'heavy' lane to prevent them from starving
  // fast memory queues and small webhook jobs.
  const changedFiles = payload.pull_request.changed_files ?? 0
  const lane = changedFiles > 50 ? 'heavy' : 'fast'

  await enqueueReviewJob({
    provider: 'github',
    kind: 'pull_request',
    owner,
    repo,
    repositoryExternalId: payload.repository.id,
    fullName: payload.repository.full_name,
    installationId,
    prNumber,
    headSha,
  }, lane)

  console.log(`[handler] Enqueued review-pr job for ${owner}/${repo}#${prNumber} on '${lane}' lane`)
}

export function registerCheckRunWebhooks(app: any) {
  app.webhooks.on("check_run.completed", async ({ payload, octokit: _octokit }: any) => {
    // Areté posts its own "Areté AI Code Review" check run for every review
    // it runs (see worker.ts). GitHub delivers check_run.completed to the
    // OWNING App for the completion of ANY check run under an installation
    // it manages — including check runs the App created itself. Without this
    // guard, Areté's own check run failing (e.g. the pipeline errored) would
    // re-trigger a fresh review here: a self-triggering loop that burns LLM
    // cost and posts duplicate reviews. Only fire for the CUSTOMER's own CI
    // checks (e.g. their GitHub Actions workflow), never Areté's own.
    if (payload.check_run.name === ARETE_CHECK_RUN_NAME) {
      console.log(
        `[handler] Ignoring check_run.completed for Areté's own check run "${payload.check_run.name}" (avoiding self-trigger loop)`
      )
      return
    }

    if (payload.check_run.conclusion !== "failure") {
      return
    }

    if (!payload.check_run.pull_requests || payload.check_run.pull_requests.length === 0) {
      return
    }

    const prNumber = payload.check_run.pull_requests[0].number
    const owner = payload.repository.owner.login
    const repo = payload.repository.name
    const headSha = payload.check_run.head_sha
    const installationId = payload.installation?.id
    const ciLogs = payload.check_run.output?.text || "No logs provided by GitHub Actions."

    console.log(`[handler] CI Failure detected for ${owner}/${repo}#${prNumber}`)

    if (!installationId) {
      console.warn(
        `[handler] No installation id on check_run payload for ${owner}/${repo}#${prNumber} — cannot enqueue CI diagnosis job`
      )
      return
    }

    await enqueueReviewJob({
      provider: 'github',
      kind: 'check_run',
      owner,
      repo,
      repositoryExternalId: payload.repository.id,
      fullName: payload.repository.full_name,
      installationId,
      prNumber,
      headSha,
      ciLogs,
    })

    console.log(`[handler] Enqueued CI diagnosis job for ${owner}/${repo}#${prNumber}`)
  })
}
