import { Queue, type JobsOptions } from 'bullmq'
// Named import rather than the default export: under "moduleResolution":
// "nodenext" (real ESM, see tsconfig.json), TS resolves ioredis's CJS default
// export as a namespace object rather than the Redis class, so `IORedis` can't
// be used as both a value and a type. ioredis also exports the same class as
// a named `Redis` binding, which doesn't have that ambiguity.
import { Redis as IORedis } from 'ioredis'

// Job queue for the review pipeline. The webhook handlers (webhook-handler.ts,
// gitlab-handler.ts) only validate the incoming event and enqueue a job here —
// they never run fetchPRContext/runReviewPipeline/postReview/persistReview
// in-process. worker.ts is the sole consumer and does the actual (potentially
// multi-minute) work, with a bounded concurrency so a burst of PRs can't fan
// out into unbounded LLM calls.

export const REVIEW_QUEUE_NAME = 'review-pr'
export const REVIEW_QUEUE_HEAVY_NAME = 'review-pr-heavy'
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

let queueFast: Queue<ReviewJobData> | null = null
let queueHeavy: Queue<ReviewJobData> | null = null

export function getReviewQueue(lane: 'fast' | 'heavy' = 'fast'): Queue<ReviewJobData> {
  if (lane === 'fast') {
    if (!queueFast) queueFast = new Queue<ReviewJobData>(REVIEW_QUEUE_NAME, { connection: getConnection() })
    return queueFast
  } else {
    if (!queueHeavy) queueHeavy = new Queue<ReviewJobData>(REVIEW_QUEUE_HEAVY_NAME, { connection: getConnection() })
    return queueHeavy
  }
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
}

export async function enqueueReviewJob(data: ReviewJobData, lane: 'fast' | 'heavy' = 'fast') {
  const qName = lane === 'fast' ? REVIEW_QUEUE_NAME : REVIEW_QUEUE_HEAVY_NAME
  return getReviewQueue(lane).add(qName, data, DEFAULT_JOB_OPTIONS)
}

/** For graceful shutdown and test cleanup. */
export async function closeReviewQueue(): Promise<void> {
  await queueFast?.close()
  await queueHeavy?.close()
  await connection?.quit()
  queueFast = null
  queueHeavy = null
  connection = null
}
