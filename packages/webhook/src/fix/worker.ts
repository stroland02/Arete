import { Worker } from 'bullmq'
import { Redis as IORedis } from 'ioredis'
import { FIX_QUEUE_NAME, type FixJobData } from '../queue.js'
import { runFixJob } from './run.js'

// Low concurrency: each run is a full LLM authoring pass on the agents
// service (§3 budget: up to 300s each).
export const FIX_QUEUE_CONCURRENCY = 2

/** Start the BullMQ worker on the fix-workitem queue. Mirrors
 *  startApprovalWorker; runFixJob records every outcome itself (never throws),
 *  so BullMQ-level retries only cover crashes before the run recorded
 *  anything. Its live run needs Redis — the per-job logic is proven by
 *  run.test.ts. */
export function startFixWorker(): Worker<FixJobData> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })
  return new Worker<FixJobData>(
    FIX_QUEUE_NAME,
    async (job) => {
      await runFixJob(job.data)
    },
    { connection, concurrency: FIX_QUEUE_CONCURRENCY },
  )
}
