// Consumer of the `fix-drive` queue (Phase 2 Task 5). The enqueue side lives
// in queue.ts (enqueueFixDrive); this is the gap worker.ts registers, mirroring
// approval-worker.ts's shape for the approval-exec queue.
//
// Retry-safety analysis (required by the task brief — do not skip this when
// touching this file): driveFix (../fix/trigger.ts) documents "Never throws —
// every failure path lands the container in fix_failed and returns the
// WorkItem to open." Reading its body confirms that contract holds because
// every prisma WRITE call (issueContainer.update, workItem.update) is wrapped
// in its own try/catch that logs and swallows rather than rethrowing — the
// three unguarded calls that CAN throw (workItem.findUnique,
// installation.findUnique, repository.findFirst) all happen BEFORE the first
// container write (fanning_out), so an exception from one of them propagates
// with no prior write to duplicate or corrupt. Consequences for this queue:
//   - There is nothing for BullMQ's `attempts`/backoff to retry on a business
//     failure (fix_failed) — driveFix resolves, it does not reject, on that
//     path. Do NOT add an "if fix_failed, throw" branch here the way
//     approval-worker.ts throws UnrecoverableError on a deterministic apply
//     failure: an automatic instant/backoff retry of a failed fix would race
//     a second full checkout + LLM call against the human-facing cooldown
//     Task 6 adds on top of this queue, defeating the point of it.
//   - `attempts` (DEFAULT_JOB_OPTIONS in queue.ts) still matters for genuine
//     infra exceptions surfacing from the three unguarded reads above — and
//     retrying those is safe by the argument in the previous paragraph.
import type { Job } from 'bullmq'
import { Worker } from 'bullmq'
// Named import rather than the default export — see the comment in queue.ts:
// under "moduleResolution": "nodenext", ioredis's default export can't be
// used as both a value and a type, but its named `Redis` export can.
import { Redis as IORedis } from 'ioredis'
import { BullMQOtel } from 'bullmq-otel'
import { createApp } from '../github-auth.js'
import { FIX_QUEUE_NAME, FIX_QUEUE_CONCURRENCY, type FixDriveJobData } from '../queue.js'
import { recordQueueJob, recordFixCooldownDrop } from '../observability.js'
import { logger } from '../logger.js'
import { driveFix, defaultFixTriggerDeps, type FixTriggerDeps, type FixDriveResult } from './trigger.js'
import { checkFixCooldown, defaultCooldownDeps, type FixCooldownResult } from './cooldown.js'

const log = logger.child({ component: 'fix-queue-consumer' })

export interface ProcessFixJobDeps {
  /** Injectable for tests; defaults to the real driveFix. */
  driveFix?: (workItemId: string, deps: FixTriggerDeps) => Promise<FixDriveResult>
  /** Injectable for tests; defaults to real deps built from a fresh App instance
   *  (mirrors worker.ts's processReviewJob, which also calls createApp() per job
   *  rather than sharing one App across the process). */
  buildDeps?: () => FixTriggerDeps
  /** Injectable for tests; defaults to the real checkFixCooldown against
   *  @arete/db (Task 6). This is the second of the two cooldown enforcement
   *  points — the dashboard route is the first (returns 429 + Retry-After
   *  before ever enqueueing). Here, a cooldown that's active DROPS the job
   *  rather than running it: driveFix never even sees a job whose work item
   *  is still inside its backoff window. */
  checkCooldown?: (workItemId: string) => Promise<FixCooldownResult>
}

/**
 * Processes a single `fix-drive` job. Exported (independent of the BullMQ
 * `Worker` wiring below) so it can be exercised directly in tests without a
 * real Redis connection, same pattern as processReviewJob/processApprovalJob.
 */
export async function processFixJob(
  data: FixDriveJobData,
  deps: ProcessFixJobDeps = {},
): Promise<FixDriveResult> {
  const checkCooldown = deps.checkCooldown ?? ((workItemId: string) => checkFixCooldown(workItemId, defaultCooldownDeps()))
  const cooldown = await checkCooldown(data.workItemId)
  if (!cooldown.allowed) {
    log.warn(
      { workItemId: data.workItemId, retryAfterSeconds: cooldown.retryAfterSeconds },
      'Fix job dropped — cooldown active',
    )
    // A dropped job never calls driveFix, so it would otherwise be a silent
    // gap under the BullMQ consumer span: no fix.run, no record of why
    // nothing happened. Record it as its own lightweight span instead.
    recordFixCooldownDrop(data.workItemId, cooldown.retryAfterSeconds ?? 0)
    return { ok: false, reason: 'cooldown', retryAfterSeconds: cooldown.retryAfterSeconds }
  }

  const drive = deps.driveFix ?? driveFix
  const buildDeps = deps.buildDeps ?? (() => defaultFixTriggerDeps(createApp()))

  const result = await drive(data.workItemId, buildDeps())
  if (!result.ok) {
    // not_found / no_container: the WorkItem or its container vanished between
    // enqueue and processing. Nothing to retry — log and complete the job.
    log.warn({ workItemId: data.workItemId, reason: result.reason }, 'Fix job could not run')
  }
  return result
}

/**
 * Starts the BullMQ worker that consumes the `fix-drive` queue. Runs in the
 * same worker process as the review/approval consumers (see the `worker`
 * pnpm script) so a burst of fix triggers never blocks — or is blocked by —
 * webhook delivery acknowledgement. Concurrency is capped so a burst of
 * triggers can't fan out into unbounded repo checkouts + LLM calls.
 */
export function startFixWorker(): Worker<FixDriveJobData> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })

  const worker = new Worker<FixDriveJobData>(
    FIX_QUEUE_NAME,
    async (job: Job<FixDriveJobData>) => {
      await processFixJob(job.data)
    },
    {
      connection,
      concurrency: FIX_QUEUE_CONCURRENCY,
      // See the deviation note in queue.ts: bullmq-otel@2.0.0's BullMQOtel
      // constructor takes a BullMQOtelOptions object, not a bare string. Same
      // tracerName as startReviewWorker/startApprovalWorker — all three are
      // consumer-side instances in the worker process; the producer side
      // (queue.ts's getFixQueue) uses the separate 'arete-webhook' instance.
      telemetry: new BullMQOtel({ tracerName: 'arete-worker' }),
    },
  )

  worker.on('completed', (job) => {
    recordQueueJob(FIX_QUEUE_NAME, 'completed')
    log.info({ jobId: job.id }, 'Job completed')
  })
  worker.on('failed', (job, err) => {
    recordQueueJob(FIX_QUEUE_NAME, 'failed')
    log.error({ err, jobId: job?.id }, 'Job failed')
  })

  return worker
}
