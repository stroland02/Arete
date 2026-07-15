import { createServer, type Server } from 'node:http'
import { describe, expect, test } from 'vitest'
import { emitReviewCreated } from './emit.js'
import { InMemoryWebhookStore } from './store.js'

process.env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS = '1'

function startReceiver(): Promise<{ url: string; count: () => number; close: () => Promise<void> }> {
  let count = 0
  const server: Server = createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      count += 1
      res.statusCode = 200
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

describe('emitReviewCreated', () => {
  test('maps a completed review to a review.created dispatch and delivers it', async () => {
    const rx = await startReceiver()
    try {
      const store = new InMemoryWebhookStore()
      await store.createEndpoint({ installationId: 'inst_e', url: rx.url, events: ['review.created'] })

      const rows = await emitReviewCreated(store, {
        installationId: 'inst_e',
        reviewId: 'rev_42',
        prNumber: 7,
        repositoryFullName: 'acme/rocket',
        riskLevel: 'medium',
      })

      expect(rows).toHaveLength(1)
      expect(rows[0].event).toBe('review.created')
      expect(rows[0].status).toBe('delivered')
      expect(rx.count()).toBe(1)
    } finally {
      await rx.close()
    }
  })

  test('no subscribed endpoint → no delivery, no throw', async () => {
    const store = new InMemoryWebhookStore()
    const rows = await emitReviewCreated(store, {
      installationId: 'inst_none',
      reviewId: 'rev_1',
      prNumber: 1,
      repositoryFullName: 'a/b',
      riskLevel: 'low',
    })
    expect(rows).toHaveLength(0)
  })
})
