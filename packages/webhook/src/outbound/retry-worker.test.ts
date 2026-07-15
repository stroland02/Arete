import { createServer, type Server } from 'node:http'
import { describe, expect, test } from 'vitest'
import { processDueDeliveries } from './retry-worker.js'
import { InMemoryWebhookStore } from './store.js'

process.env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS = '1'

function startReceiver(status: number): Promise<{ url: string; count: () => number; close: () => Promise<void> }> {
  let count = 0
  const server: Server = createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      count += 1
      res.statusCode = status
      res.end('ok')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ url: `http://127.0.0.1:${port}/hook`, count: () => count, close: () => new Promise((r) => server.close(() => r())) })
    })
  })
}

const PAYLOAD = { event: 'review.created', occurred_at: 'x', review: {}, message: { title: 't', body: 'b' } }

// Make a due, pending delivery: record then settle to pending with a nextAttempt.
// We drive "due" by passing a future `now` to the worker rather than sleeping.
async function seedDueDelivery(store: InMemoryWebhookStore, url: string, attempts: number) {
  const ep = await store.createEndpoint({ installationId: 'inst_w', url, events: ['review.created'] })
  const row = await store.recordDelivery({ endpointId: ep.id, event: 'review.created', payload: PAYLOAD })
  await store.settleDelivery(row.id, { status: 'pending', code: 503, error: 'x', attempts, nextAttemptMs: 30_000 })
  return row
}

describe('processDueDeliveries', () => {
  test('re-delivers only due pending deliveries and marks a success delivered', async () => {
    const rx = await startReceiver(200)
    try {
      const store = new InMemoryWebhookStore()
      const due = await seedDueDelivery(store, rx.url, 1) // nextAttempt ≈ now+30s
      // A second delivery with no nextAttempt is NOT due.
      const ep2 = await store.createEndpoint({ installationId: 'inst_w', url: rx.url, events: ['review.created'] })
      await store.recordDelivery({ endpointId: ep2.id, event: 'review.created', payload: PAYLOAD })

      const future = new Date(Date.now() + 60_000)
      const results = await processDueDeliveries(store, future)

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe(due.id)
      expect(results[0].status).toBe('delivered')
      expect(results[0].attempts).toBe(2) // was 1, this is attempt 2
      expect(rx.count()).toBe(1) // only the due one was sent
    } finally {
      await rx.close()
    }
  })

  test('a still-failing due delivery advances attempts and the backoff', async () => {
    const rx = await startReceiver(503)
    try {
      const store = new InMemoryWebhookStore()
      await seedDueDelivery(store, rx.url, 2) // was attempt 2, next is attempt 3

      const future = new Date(Date.now() + 60_000)
      const [settled] = await processDueDeliveries(store, future)

      expect(settled.status).toBe('pending')
      expect(settled.attempts).toBe(3)
      expect(settled.nextAttempt).toBeInstanceOf(Date) // rescheduled (backoff advanced)
    } finally {
      await rx.close()
    }
  })
})
