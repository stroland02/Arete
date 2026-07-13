import type { Job } from 'bullmq'
import { Worker, UnrecoverableError } from 'bullmq'
import { pathToFileURL } from 'node:url'
// Named import rather than the default export — see the comment in queue.ts:
// under "moduleResolution": "nodenext", ioredis's default export can't be
// used as both a value and a type, but its named `Redis` export can.
import { Redis as IORedis } from 'ioredis'
import type { Octokit } from '@octokit/core'
import { createApp, getInstallationOctokit } from './github-auth.js'
import { fetchPRContext } from './pr-fetcher.js'
import { fetchTelemetryContext } from './telemetry/fetch-telemetry-context.js'
import { fetchGitLabMRContext } from './gitlab-fetcher.js'
import { runReviewPipeline } from './review-bridge.js'
import { postReview } from './comment-poster.js'
import { postGitLabReview, type DiffRefs } from './gitlab-comment-poster.js'
import { persistReview, persistTelemetrySnapshots } from './persistence.js'
import { ARETE_CHECK_RUN_NAME } from './constants.js'
import {
  REVIEW_QUEUE_NAME,
  REVIEW_QUEUE_CONCURRENCY,
  type ReviewJobData,
  type GitHubPullRequestJobData,
  type GitHubCheckRunJobData,
  type GitLabMergeRequestJobData,
} from './queue.js'

/**
 * Runs the review pipeline for a GitHub `pull_request` job: fetch diff,
 * create the in-progress check run, call the LLM pipeline, post the review,
 * resolve the check run, and persist. This is where the heavy lifting that
 * used to happen synchronously inside the webhook handler now lives.
 */
async function processGitHubPullRequest(octokit: Octokit, data: GitHubPullRequestJobData): Promise<void> {
  const { owner, repo, prNumber, headSha, installationId, repositoryExternalId, fullName } = data

  const prContext = await fetchPRContext(octokit, owner, repo, prNumber)
  // `installationId` here is the GitHub App's numeric installation id
  // (Installation.externalId), not the internal Installation UUID —
  // fetchTelemetryContext resolves the UUID itself, like persistReview.
  prContext.telemetry = await fetchTelemetryContext(
    octokit,
    'github',
    installationId,
    owner,
    repo,
    prContext.telemetryConnectors ?? []
  )

  const checkRun = await (octokit as any).rest.checks.create({
    owner,
    repo,
    name: ARETE_CHECK_RUN_NAME,
    head_sha: headSha,
    status: 'in_progress',
    output: { title: 'Review in progress', summary: 'Areté is actively analyzing your code...' },
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
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: 'Review Failed',
        summary: `Areté encountered an error while reviewing this PR: ${err instanceof Error ? err.message : String(err)}`,
      },
    })
    throw err
  }

  await (octokit as any).rest.checks.update({
    owner,
    repo,
    check_run_id: checkRunId,
    status: 'completed',
    conclusion: result.risk_level === 'high' || result.risk_level === 'critical' ? 'action_required' : 'success',
    output: { title: 'Review Complete', summary: result.overall_summary },
  })

  try {
    await persistReview({
      provider: 'github',
      installationExternalId: installationId,
      repositoryExternalId,
      owner,
      name: repo,
      fullName,
      prNumber,
      headSha,
      result,
    })
  } catch (err) {
    console.error('[worker] Failed to persist review (review was still posted):', err)
  }

  try {
    await persistTelemetrySnapshots({
      provider: 'github',
      installationExternalId: installationId,
      snapshots: prContext.telemetry ?? [],
    })
  } catch (err) {
    console.error('[worker] Failed to persist telemetry snapshots (review was still posted):', err)
  }

  console.log(`[worker] Posted review — risk: ${result.risk_level}, comments: ${result.total_comments}`)
}

/**
 * Runs the CI-diagnosis flow for a GitHub `check_run` job: same pipeline as
 * a normal review, but with the customer's CI logs attached to the context
 * so the LLM can diagnose the failure.
 */
async function processGitHubCheckRun(octokit: Octokit, data: GitHubCheckRunJobData): Promise<void> {
  const { owner, repo, prNumber, headSha, installationId, repositoryExternalId, fullName, ciLogs } = data

  const prContext = await fetchPRContext(octokit, owner, repo, prNumber)
  prContext.ciLogs = ciLogs

  const checkRun = await (octokit as any).rest.checks.create({
    owner,
    repo,
    name: ARETE_CHECK_RUN_NAME,
    head_sha: headSha,
    status: 'in_progress',
    output: { title: 'Diagnosing CI Failure', summary: 'Areté is actively analyzing your code...' },
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
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: 'Review Failed',
        summary: `Areté encountered an error while diagnosing this CI failure: ${err instanceof Error ? err.message : String(err)}`,
      },
    })
    throw err
  }

  await (octokit as any).rest.checks.update({
    owner,
    repo,
    check_run_id: checkRunId,
    status: 'completed',
    conclusion: result.risk_level === 'high' || result.risk_level === 'critical' ? 'action_required' : 'success',
    output: { title: 'Review Complete', summary: result.overall_summary },
  })

  try {
    await persistReview({
      provider: 'github',
      installationExternalId: installationId,
      repositoryExternalId,
      owner,
      name: repo,
      fullName,
      prNumber,
      headSha,
      result,
    })
  } catch (err) {
    console.error('[worker] Failed to persist review (review was still posted):', err)
  }

  console.log(`[worker] Posted CI diagnosis — risk: ${result.risk_level}, comments: ${result.total_comments}`)
}

async function processGitLabMergeRequest(data: GitLabMergeRequestJobData): Promise<void> {
  const { projectId, mrIid, payload } = data

  const diffRefs: DiffRefs = {
    baseSha: payload.object_attributes?.diff_refs?.base_sha ?? '',
    startSha: payload.object_attributes?.diff_refs?.start_sha ?? '',
    headSha: payload.object_attributes?.last_commit?.id
      ?? payload.object_attributes?.diff_refs?.head_sha
      ?? '',
  }

  const prContext = await fetchGitLabMRContext(projectId, mrIid, payload)
  const result = await runReviewPipeline(prContext)
  await postGitLabReview(projectId, mrIid, result, diffRefs)

  const fullName: string = payload.project?.path_with_namespace || `project-${projectId}`
  const owner = fullName.split('/')[0]
  const name = fullName.split('/').pop() ?? fullName

  try {
    await persistReview({
      provider: 'gitlab',
      installationExternalId: projectId,
      repositoryExternalId: projectId,
      owner,
      name,
      fullName,
      prNumber: mrIid,
      headSha: diffRefs.headSha,
      result,
    })
  } catch (err) {
    console.error('[worker] Failed to persist review (review was still posted):', err)
  }

  console.log(
    `[worker] Posted review for ${fullName}!${mrIid} — risk: ${result.risk_level}, comments: ${result.total_comments}`
  )
}

/**
 * Processes a single `review-pr` job. Exported (independent of the BullMQ
 * `Worker` wiring below) so it can be exercised directly in tests without a
 * real Redis connection — the integration tests capture the job data the
 * webhook handlers enqueue and feed it straight into this function to
 * simulate what the worker process would do.
 */
export async function processReviewJob(data: ReviewJobData): Promise<void> {
  // Poison Message Guard: Structurally malformed payloads are permanently rejected.
  // This prevents BullMQ from retrying them (which creates a sawtooth pattern in latency).
  if (!data || !data.provider) {
    throw new UnrecoverableError('PoisonMessage: Job data is empty or missing provider')
  }
  if (data.provider === 'github' && (!data.headSha || !data.prNumber || !data.owner || !data.repo)) {
    throw new UnrecoverableError('PoisonMessage: GitHub job missing critical identifier fields')
  }

  if (data.provider === 'github') {
    const app = createApp()
    const octokit = await getInstallationOctokit(app, data.installationId)
    if (data.kind === 'pull_request') {
      await processGitHubPullRequest(octokit, data)
    } else {
      await processGitHubCheckRun(octokit, data)
    }
    return
  }

  await processGitLabMergeRequest(data)
}

/**
 * Starts the BullMQ worker that consumes the `review-pr` queue. Runs in its
 * own process (see the `worker` pnpm script) so a burst of PRs or a slow LLM
 * call never blocks webhook delivery acknowledgement. Concurrency is capped
 * so a burst of PRs can't fan out into unbounded LLM calls against the
 * Python review service.
 */
export function startReviewWorker(): Worker<ReviewJobData> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })

  const worker = new Worker<ReviewJobData>(
    REVIEW_QUEUE_NAME,
    async (job: Job<ReviewJobData>) => {
      await processReviewJob(job.data)
    },
    {
      connection,
      concurrency: REVIEW_QUEUE_CONCURRENCY,
    }
  )

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed`)
  })
  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err)
  })

  return worker
}

// Only start the worker when this file is run directly (e.g. `pnpm worker`),
// not when it's imported by tests. `require.main === module` is the CJS
// idiom for this and isn't available in ESM (see tsconfig.json: module/
// moduleResolution "nodenext") — this is the standard ESM equivalent,
// comparing this module's URL to the URL of the process's entry script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Areté review worker starting (concurrency: ${REVIEW_QUEUE_CONCURRENCY})...`)
  startReviewWorker()
}
