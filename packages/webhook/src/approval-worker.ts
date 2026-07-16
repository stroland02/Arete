import { UnrecoverableError, Worker } from 'bullmq'
import { Redis as IORedis } from 'ioredis'
import { getServiceConfig } from './config.js'
import { APPROVAL_QUEUE_NAME, type ApprovalExecutionJobData } from './queue.js'

// Consumer of the `approval-exec` queue (the enqueue side already ships in
// queue.ts; worker.ts only consumes the review queue — this is the gap).
// It hands a human-approved command to the Python agents service, which owns the
// actual apply/resume work, then completes or retries based on the response.
//
// Contract (owned by the PM across both lanes — do NOT change here):
//   POST {approvalId, reviewId, command}  ->  agents FastAPI /approvals/apply
//   returns { status: "applied" | "failed", detail, resumedRunId? }, idempotent
//   per approvalId. We resolve on "applied" and throw on "failed" (or any
//   transport error) so BullMQ's DEFAULT_JOB_OPTIONS backoff retries safely —
//   idempotency makes a retried apply harmless.

const DEFAULT_TIMEOUT_MS = 120_000

export interface ApprovalApplyResult {
  status: 'applied' | 'failed'
  detail: string
  resumedRunId?: string
}

export interface ApplyOptions {
  /** Override the agents service base URL; defaults to config. Injectable for tests. */
  baseUrl?: string
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** POST the approved command to the agents service's /approvals/apply and return
 *  its result. Throws on timeout or a non-2xx response (both retryable). This is
 *  the review-bridge.ts-style transport fn for the approval lane. */
export async function applyApproval(
  data: ApprovalExecutionJobData,
  options: ApplyOptions = {},
): Promise<ApprovalApplyResult> {
  const baseUrl = options.baseUrl ?? getServiceConfig().pythonServiceUrl
  const doFetch = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const res = await doFetch(`${baseUrl}/approvals/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        approvalId: data.approvalId,
        reviewId: data.reviewId,
        command: data.command,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`/approvals/apply returned ${res.status}`)
    }
    return (await res.json()) as ApprovalApplyResult
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('/approvals/apply timed out after 120s')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export interface ProcessApprovalDeps {
  apply?: (data: ApprovalExecutionJobData) => Promise<ApprovalApplyResult>
}

/** Process one approval-exec job. Three outcomes, per the Eng3 contract:
 *   - 200 {status:"applied"} → resolve (terminal success).
 *   - 200 {status:"failed"}  → the command ran and deterministically failed;
 *     throw UnrecoverableError so BullMQ does NOT retry (retrying is wasteful —
 *     Eng3 is idempotent and the outcome won't change). Logged as terminal.
 *   - non-2xx / timeout / network → applyApproval throws a regular Error, which
 *     propagates here unchanged → BullMQ backoff retries. */
export async function processApprovalJob(
  data: ApprovalExecutionJobData,
  deps: ProcessApprovalDeps = {},
): Promise<void> {
  const apply = deps.apply ?? applyApproval
  // A regular Error thrown here (transport/non-2xx/timeout) is retryable.
  const result = await apply(data)
  if (result.status === 'applied') {
    console.log(
      `[approval-worker] Applied approval ${data.approvalId}` +
        (result.resumedRunId ? ` (resumed run ${result.resumedRunId})` : ''),
    )
    return
  }
  // Terminal failure: the apply ran and failed deterministically. Log it and
  // throw UnrecoverableError so BullMQ marks the job failed WITHOUT retrying.
  console.error(
    `[approval-worker] Approval ${data.approvalId} failed terminally (no retry): ${result.detail}`,
  )
  throw new UnrecoverableError(`approval ${data.approvalId} apply failed: ${result.detail}`)
}

/** Start the BullMQ worker on the approval-exec queue. Mirrors startReviewWorker;
 *  its live run needs Redis, so it's a deferred smoke test — the per-job logic is
 *  proven by processApprovalJob's tests. */
export function startApprovalWorker(): Worker<ApprovalExecutionJobData> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })
  return new Worker<ApprovalExecutionJobData>(
    APPROVAL_QUEUE_NAME,
    async (job) => {
      await processApprovalJob(job.data)
    },
    { connection },
  )
}
