import { Queue, type JobsOptions } from 'bullmq'
// Named import rather than the default export: under "moduleResolution":
// "nodenext" (real ESM, see tsconfig.json), TS resolves ioredis's CJS default
// export as a namespace object rather than the Redis class, so `IORedis` can't
// be used as both a value and a type. ioredis also exports the same class as
// a named `Redis` binding, which doesn't have that ambiguity.
import { Redis as IORedis } from 'ioredis'
import { BullMQOtel } from 'bullmq-otel'

// Job queue for the review pipeline. The webhook handlers (webhook-handler.ts,
// gitlab-handler.ts) only validate the incoming event and enqueue a job here —
// they never run fetchPRContext/runReviewPipeline/postReview/persistReview
// in-process. worker.ts is the sole consumer and does the actual (potentially
// multi-minute) work, with a bounded concurrency so a burst of PRs can't fan
// out into unbounded LLM calls.

export const REVIEW_QUEUE_NAME = 'review-pr'
export const REVIEW_QUEUE_HEAVY_NAME = 'review-pr-heavy'
export const REVIEW_QUEUE_CONCURRENCY = 5

// Concurrency for the heavy lane's OWN Worker (worker.ts's startReviewWorkers
// runs a separate consumer per lane — see the defect note there). Lower than
// the fast lane's: a >50-file PR is a bigger diff pushed through the same
// LLM review pipeline, so fewer of them should run at once even though they
// have a dedicated queue.
export const REVIEW_QUEUE_HEAVY_CONCURRENCY = 2

// Separate queue for executing a human-approved infrastructure command
// (POST /api/approvals/:id/execute). It is deliberately NOT the review queue:
// applying an approved fix / resuming the paused agent run is a different unit
// of work from reviewing a PR, and isolating it means a backlog of reviews can
// never delay an operator-approved remediation (and vice-versa).
export const APPROVAL_QUEUE_NAME = 'approval-exec'

// Queue for the healing-loop fix drive (POST /fix/trigger). Before this, the
// route ran `void driveFix(...)` inline on the webhook's HTTP request process
// — no queue, no concurrency cap, so a burst of triggers could fan out into
// unbounded repo checkouts + LLM calls on the same process answering GitHub
// webhooks. Concurrency is lower than review's: a fix drive does a full repo
// checkout on top of the LLM call.
export const FIX_QUEUE_NAME = 'fix-drive'
export const FIX_QUEUE_CONCURRENCY = 2

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

/** Payload for an approval-execution job: everything a downstream worker needs
 *  to apply the approved command and resume the paused agent run, without
 *  re-reading the DB. `reviewId` ties the command back to the review whose
 *  agent requested it (ApprovalPrompt.reviewId). */
export interface ApprovalExecutionJobData {
  approvalId: string
  reviewId: string
  command: string
}

/** Payload for a fix-drive job. Deliberately just the id — driveFix (fix/
 *  trigger.ts) re-reads the WorkItem, its container, the tenant's repo, and
 *  its model connection fresh from the DB rather than trusting stale data
 *  carried on the job across a possible retry/requeue. */
export interface FixDriveJobData {
  workItemId: string
}

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
let queueApproval: Queue<ApprovalExecutionJobData> | null = null
let queueFix: Queue<FixDriveJobData> | null = null

// First-party BullMQ telemetry (spec §4): producer-side span on enqueue,
// context propagated through Redis to the worker automatically.
// NOTE (deviation from task-10-brief.md): the brief's `new BullMQOtel('arete-webhook')`
// assumes a constructor(serviceName: string) — the installed bullmq-otel@2.0.0
// constructor is `constructor(tracerOptions?: BullMQOtelOptions, version?: string)`,
// so the service name is passed as `tracerName` instead.
const bullmqTelemetry = new BullMQOtel({ tracerName: 'arete-webhook' })

export function getApprovalQueue(): Queue<ApprovalExecutionJobData> {
  if (!queueApproval) {
    queueApproval = new Queue<ApprovalExecutionJobData>(APPROVAL_QUEUE_NAME, {
      connection: getConnection(),
      telemetry: bullmqTelemetry,
    })
  }
  return queueApproval
}

export function getFixQueue(): Queue<FixDriveJobData> {
  if (!queueFix) {
    queueFix = new Queue<FixDriveJobData>(FIX_QUEUE_NAME, {
      connection: getConnection(),
      telemetry: bullmqTelemetry,
    })
  }
  return queueFix
}

export function getReviewQueue(lane: 'fast' | 'heavy' = 'fast'): Queue<ReviewJobData> {
  if (lane === 'fast') {
    if (!queueFast) queueFast = new Queue<ReviewJobData>(REVIEW_QUEUE_NAME, { connection: getConnection(), telemetry: bullmqTelemetry })
    return queueFast
  } else {
    if (!queueHeavy) queueHeavy = new Queue<ReviewJobData>(REVIEW_QUEUE_HEAVY_NAME, { connection: getConnection(), telemetry: bullmqTelemetry })
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

/** Enqueues execution of a human-approved infrastructure command. Uses the
 *  same durable BullMQ retry/backoff policy as review jobs so an approved
 *  remediation survives a worker restart rather than being lost. */
export async function enqueueApprovalExecution(data: ApprovalExecutionJobData) {
  return getApprovalQueue().add(APPROVAL_QUEUE_NAME, data, DEFAULT_JOB_OPTIONS)
}

/** Enqueues a fix drive (POST /fix/trigger). Same durable retry/backoff policy
 *  as review and approval jobs. Note: driveFix's own contract (fix/trigger.ts)
 *  is that it never rejects on a business failure — every failure path lands
 *  the container in `fix_failed` and the WorkItem back in `open` on its own —
 *  so `attempts` here only ever fires on a genuine infra exception (e.g. a DB
 *  read failing before any container write), not on a "the fix didn't work"
 *  outcome. See queue-consumer.ts's header comment for the full analysis. */
export async function enqueueFixDrive(data: FixDriveJobData) {
  return getFixQueue().add(FIX_QUEUE_NAME, data, DEFAULT_JOB_OPTIONS)
}

/** For graceful shutdown and test cleanup. */
export async function closeReviewQueue(): Promise<void> {
  await queueFast?.close()
  await queueHeavy?.close()
  await queueApproval?.close()
  await queueFix?.close()
  await connection?.quit()
  queueFast = null
  queueHeavy = null
  queueApproval = null
  queueFix = null
  connection = null
}
