import { Queue, type JobsOptions } from 'bullmq'
import IORedis from 'ioredis'

// Job queue for the review pipeline. The webhook handlers (webhook-handler.ts,
// gitlab-handler.ts) only validate the incoming event and enqueue a job here —
// they never run fetchPRContext/runReviewPipeline/postReview/persistReview
// in-process. worker.ts is the sole consumer and does the actual (potentially
// multi-minute) work, with a bounded concurrency so a burst of PRs can't fan
// out into unbounded LLM calls.

export const REVIEW_QUEUE_NAME = 'review-pr'
export const REVIEW_QUEUE_CONCURRENCY = 5

export interface GitHubPullRequestJobData {
  provider: 'github'
  kind: 'pull_request'
  owner: string
  repo: string
  repositoryExternalId: number
  fullName: string
  installationId: number
  prNumber: number
  headSha: string
}

export interface GitHubCheckRunJobData {
  provider: 'github'
  kind: 'check_run'
  owner: string
  repo: string
  repositoryExternalId: number
  fullName: string
  installationId: number
  prNumber: number
  headSha: string
  ciLogs: string
}

export interface GitLabMergeRequestJobData {
  provider: 'gitlab'
  kind: 'merge_request'
  projectId: number
  mrIid: number
  /** Raw GitLab webhook body; gitlab-fetcher/comment-poster need several of
   *  its fields (title, description, diff_refs, last_commit) and re-deriving
   *  them here would just duplicate that parsing. */
  payload: any
}

export type ReviewJobData =
  | GitHubPullRequestJobData
  | GitHubCheckRunJobData
  | GitLabMergeRequestJobData

function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379'
}

let connection: IORedis | null = null
function getConnection(): IORedis {
  if (!connection) {
    // BullMQ requires this to be null so it can manage retries itself.
    connection = new IORedis(redisUrl(), { maxRetriesPerRequest: null })
  }
  return connection
}

let queue: Queue<ReviewJobData> | null = null

/** Lazily-constructed singleton so importing this module never opens a Redis
 *  connection (or fails) until a job is actually enqueued/consumed. */
export function getReviewQueue(): Queue<ReviewJobData> {
  if (!queue) {
    queue = new Queue<ReviewJobData>(REVIEW_QUEUE_NAME, { connection: getConnection() })
  }
  return queue
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
}

export async function enqueueReviewJob(data: ReviewJobData) {
  return getReviewQueue().add(REVIEW_QUEUE_NAME, data, DEFAULT_JOB_OPTIONS)
}

/** For graceful shutdown and test cleanup. */
export async function closeReviewQueue(): Promise<void> {
  await queue?.close()
  await connection?.quit()
  queue = null
  connection = null
}
