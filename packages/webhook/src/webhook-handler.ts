import type { Octokit } from '@octokit/core'
import { fetchPRContext } from './pr-fetcher.js'
import { runReviewPipeline } from './review-bridge.js'
import { postReview } from './comment-poster.js'
import { PrismaClient } from './generated/prisma/client.js'

const HANDLED_ACTIONS = new Set(['opened', 'synchronize', 'reopened'])
const prisma = new PrismaClient()

interface PullRequestPayload {
  action: string
  repository: { 
    id: number
    owner: { login: string }
    name: string
    full_name: string
  }
  pull_request: { number: number }
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
  const installationId = payload.installation?.id || 0

  console.log(`[handler] Reviewing ${owner}/${repo}#${prNumber} (${payload.action})`)

  if (installationId) {
    const installation = await prisma.installation.findFirst({
      where: { githubInstallationId: installationId }
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
  const result = await runReviewPipeline(prContext)
  await postReview(octokit, owner, repo, prNumber, result)

  // Persist to Prisma
  const [installation, repository, review] = await prisma.$transaction([
    prisma.installation.upsert({
      where: { id: installationId.toString() },
      create: { 
        id: installationId.toString(),
        githubInstallationId: installationId, 
        owner 
      },
      update: { owner }
    }),
    prisma.repository.upsert({
      where: { id: payload.repository.id.toString() },
      create: {
        id: payload.repository.id.toString(),
        githubRepoId: payload.repository.id,
        name: repo,
        fullName: payload.repository.full_name,
        installationId: installationId.toString()
      },
      update: {
        name: repo,
        fullName: payload.repository.full_name
      }
    }),
    prisma.review.create({
      data: {
        prNumber: prNumber,
        repositoryId: payload.repository.id.toString(),
        riskLevel: result.risk_level,
        overallSummary: result.overall_summary,
        comments: {
          createMany: {
            data: result.file_reviews.flatMap((fr: any) => 
              fr.comments.map((c: any) => ({
                path: fr.path,
                line: c.line,
                body: c.body,
                severity: c.severity,
                category: c.category
              }))
            )
          }
        }
      }
    })
  ])

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

    const result = await runReviewPipeline(prContext)
    await postReview(octokit, owner, repo, prNumber, result)
  })
}
