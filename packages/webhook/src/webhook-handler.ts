import type { Octokit } from '@octokit/core'
import { fetchPRContext } from './pr-fetcher.js'
import { runReviewPipeline } from './review-bridge.js'
import { postReview } from './comment-poster.js'
import { prisma } from './db.js'
import { persistReview } from './persistence.js'

const HANDLED_ACTIONS = new Set(['opened', 'synchronize', 'reopened'])

interface PullRequestPayload {
  action: string
  repository: { 
    id: number
    owner: { login: string }
    name: string
    full_name: string
  }
  pull_request: { number: number, head: { sha: string } }
  installation?: { id: number }
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
  const installationId = payload.installation?.id

  console.log(`[handler] Reviewing ${owner}/${repo}#${prNumber} (${payload.action})`)

  if (installationId) {
    const installation = await prisma.installation.findUnique({
      where: { provider_externalId: { provider: 'github', externalId: installationId } }
    })

    if (installation && (installation.subscriptionStatus === 'canceled' || installation.subscriptionStatus === 'past_due')) {
      console.log(`[handler] Subscription inactive for installation ${installationId}. Status: ${installation.subscriptionStatus}`)
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner,
        repo,
        issue_number: prNumber,
        body: 'Areté Code Review is paused due to an inactive subscription.'
      })
      return
    }
  }

  const prContext = await fetchPRContext(octokit, owner, repo, prNumber)

  const checkRun = await (octokit as any).rest.checks.create({
    owner,
    repo,
    name: "Areté AI Code Review",
    head_sha: payload.pull_request.head.sha,
    status: "in_progress",
    output: { title: "Review in progress", summary: "Areté is actively analyzing your code..." }
  })
  const checkRunId = checkRun.data.id

  let result
  try {
    result = await runReviewPipeline(prContext)
    await postReview(octokit, owner, repo, prNumber, result)
  } catch (err) {
    // Without this, a failure here (Python pipeline error, GitHub API error, etc.)
    // leaves the check run stuck "in_progress" forever on the PR.
    await (octokit as any).rest.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: "completed",
      conclusion: "failure",
      output: {
        title: "Review Failed",
        summary: `Areté encountered an error while reviewing this PR: ${err instanceof Error ? err.message : String(err)}`
      }
    })
    throw err
  }

  await (octokit as any).rest.checks.update({
    owner,
    repo,
    check_run_id: checkRunId,
    status: "completed",
    conclusion: (result.risk_level === "high" || result.risk_level === "critical") ? "action_required" : "success",
    output: { title: "Review Complete", summary: result.overall_summary }
  })

  // Persist to Prisma. The review has already been posted at this point, so
  // persistence problems (or a missing installation id) must never fail the
  // review itself — same "never block the review" pattern as telemetry.
  if (!installationId) {
    console.warn(
      `[handler] No installation id on payload for ${owner}/${repo}#${prNumber} — skipping persistence`
    )
  } else {
    try {
      await persistReview({
        provider: 'github',
        installationExternalId: installationId,
        repositoryExternalId: payload.repository.id,
        owner,
        name: repo,
        fullName: payload.repository.full_name,
        prNumber,
        headSha: payload.pull_request.head.sha,
        result,
      })
    } catch (err) {
      console.error('[handler] Failed to persist review (review was still posted):', err)
    }
  }

  console.log(`[handler] Posted review — risk: ${result.risk_level}, comments: ${result.total_comments}`)
}

export function registerCheckRunWebhooks(app: any) {
  app.webhooks.on("check_run.completed", async ({ payload, octokit }: any) => {
    if (payload.check_run.conclusion !== "failure") {
      return
    }

    if (!payload.check_run.pull_requests || payload.check_run.pull_requests.length === 0) {
      return
    }

    const prNumber = payload.check_run.pull_requests[0].number
    const owner = payload.repository.owner.login
    const repo = payload.repository.name

    const ciLogs = payload.check_run.output?.text || "No logs provided by GitHub Actions."

    console.log(`[handler] CI Failure detected for ${owner}/${repo}#${prNumber}`)

    const prContext = await fetchPRContext(octokit, owner, repo, prNumber)
    prContext.ciLogs = ciLogs

    const checkRun = await (octokit as any).rest.checks.create({
      owner,
      repo,
      name: "Areté AI Code Review",
      head_sha: payload.check_run.head_sha,
      status: "in_progress",
      output: { title: "Diagnosing CI Failure", summary: "Areté is actively analyzing your code..." }
    })
    const checkRunId = checkRun.data.id

    let result
    try {
      result = await runReviewPipeline(prContext)
      await postReview(octokit, owner, repo, prNumber, result)
    } catch (err) {
      await (octokit as any).rest.checks.update({
        owner,
        repo,
        check_run_id: checkRunId,
        status: "completed",
        conclusion: "failure",
        output: {
          title: "Review Failed",
          summary: `Areté encountered an error while diagnosing this CI failure: ${err instanceof Error ? err.message : String(err)}`
        }
      })
      throw err
    }

    await (octokit as any).rest.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: "completed",
      conclusion: (result.risk_level === "high" || result.risk_level === "critical") ? "action_required" : "success",
      output: { title: "Review Complete", summary: result.overall_summary }
    })
  })
}
