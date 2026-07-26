import { deliverWebhook } from './deliver.js'
import type { WebhookPayload } from './payload.js'
import type { StoredDelivery, WebhookStore } from './store.js'
import { PrismaWebhookStore, type WebhookPrismaClient } from './prisma-store.js'
import { prisma } from '../db.js'
import { logger } from '../logger.js'

const log = logger.child({ component: 'outbound' })

// Retry worker for outbound webhooks. The schedule lives in the database:
// WebhookDelivery.nextAttempt (indexed by [status, nextAttempt]) is the due-time,
// so this is a Postgres-polling loop — no Redis/queue needed. Each tick selects
// due pending deliveries, re-sends them, and settles the row (which advances
// attempts + reschedules via the backoff curve, or marks failed when exhausted).
//
// `processDueDeliveries` is the unit — pure logic over the store, fully tested.
// `startRetryWorker` is the thin scheduled wrapper; its live run against real
// Postgres is the deferred smoke test.

/** Process every delivery whose retry is due as of `now`. Returns the settled
 *  rows. Each delivery is independent — one failure never blocks another. */
export async function processDueDeliveries(
  store: WebhookStore,
  now: Date = new Date(),
): Promise<StoredDelivery[]> {
  const due = await store.dueDeliveries(now)
  return Promise.all(
    due.map(async ({ delivery, endpoint }) => {
      const outcome = await deliverWebhook(
        { id: endpoint.id, url: endpoint.url, secret: endpoint.secret },
        delivery.payload as WebhookPayload,
        delivery.id,
        { attemptsMade: delivery.attempts },
      )
      return store.settleDelivery(delivery.id, outcome)
    }),
  )
}

export interface RetryWorkerHandle {
  stop(): void
}

/** Start the polling retry loop. Deferred: exercising this against real Postgres
 *  is a post-merge smoke test — the per-tick logic is proven by
 *  processDueDeliveries' tests. Overlap-guarded so a slow tick can't stack. */
export function startRetryWorker(
  store: WebhookStore,
  options: { intervalMs?: number } = {},
): RetryWorkerHandle {
  const intervalMs = options.intervalMs ?? 30_000
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      await processDueDeliveries(store)
    } catch (err) {
      log.error({ err }, 'tick failed')
    } finally {
      running = false
    }
  }, intervalMs)
  // Don't keep the process alive just for the retry loop.
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

/** Production entrypoint: the retry loop over the real Prisma-backed store.
 *
 *  This exists because `startRetryWorker` shipped with no caller — deliveries
 *  recorded a `nextAttempt` and were then never retried. Keep the store
 *  construction here rather than at the call site so the worker entrypoint can
 *  start it with no arguments, the same shape as startApprovalWorker(). */
export function startOutboundRetryWorker(): RetryWorkerHandle {
  const raw = Number(process.env.OUTBOUND_RETRY_INTERVAL_MS)
  // A malformed env var must not degrade into setInterval(fn, NaN), which fires
  // as fast as the event loop allows and would hammer Postgres.
  const intervalMs = Number.isFinite(raw) && raw > 0 ? raw : 30_000
  const store = new PrismaWebhookStore(prisma as unknown as WebhookPrismaClient)
  log.info({ intervalMs }, 'outbound retry worker starting')
  return startRetryWorker(store, { intervalMs })
}
