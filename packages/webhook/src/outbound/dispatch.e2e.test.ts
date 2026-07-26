import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { describe, expect, test } from 'vitest'
import { dispatchEvent } from './dispatch.js'
import { verifyWebhookSignature } from './signature.js'
import { InMemoryWebhookStore } from './store.js'

// End-to-end drive of the whole outbound path against a LIVE receiver:
//   register endpoint → fire a review event → signed delivery over a socket →
//   delivery row recorded with status → failure path schedules a retry.
// The one piece not exercised here is Postgres durability — the store is the
// in-memory impl; the Prisma-backed store is verified separately in a DB env
// (see the runbook). Everything else is real.
process.env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS = '1'

function startReceiver(statusFor: () => number): Promise<{
  url: string
  received: { headers: IncomingMessage['headers']; rawBody: string }[]
  close: () => Promise<void>
}> {
  const received: { headers: IncomingMessage['headers']; rawBody: string }[] = []
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      received.push({ headers: req.headers, rawBody: body })
      res.statusCode = statusFor()
      res.end('ok')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/hook`,
        received,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

const REVIEW = { id: 'rev_e2e', prNumber: 101, repositoryFullName: 'acme/rocket', riskLevel: 'high' }

describe('outbound webhooks — end-to-end', () => {
  test('register → fire review.created → signed delivery → row recorded delivered', async () => {
    const rx = await startReceiver(() => 202)
    try {
      const store = new InMemoryWebhookStore()
      const ep = await store.createEndpoint({
        installationId: 'inst_e2e',
        url: rx.url,
        events: ['review.created'],
      })

      const rows = await dispatchEvent(store, {
        installationId: 'inst_e2e',
        event: 'review.created',
        review: REVIEW,
        occurredAtIso: '2026-07-15T12:00:00.000Z',
      })

      // A delivery row was recorded, delivered.
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('delivered')
      expect(rows[0].lastCode).toBe(202)
      expect(rows[0].attempts).toBe(1)

      // The receiver actually got the signed request; signature verifies and the
      // Arete-Delivery header equals the recorded row id (idempotency key).
      expect(rx.received).toHaveLength(1)
      const got = rx.received[0]
      expect(got.headers['arete-delivery']).toBe(rows[0].id)
      expect(verifyWebhookSignature(ep.secret, got.headers['arete-signature'] as string, got.rawBody)).toBe(true)
    } finally {
      await rx.close()
    }
  })

  test('a failing endpoint records a pending row with a scheduled retry', async () => {
    const rx = await startReceiver(() => 503)
    try {
      const store = new InMemoryWebhookStore()
      await store.createEndpoint({ installationId: 'inst_e2e', url: rx.url, events: ['review.created'] })

      const rows = await dispatchEvent(store, {
        installationId: 'inst_e2e',
        event: 'review.created',
        review: REVIEW,
        occurredAtIso: '2026-07-15T12:00:00.000Z',
      })

      expect(rows[0].status).toBe('pending')
      expect(rows[0].lastCode).toBe(503)
      expect(rows[0].attempts).toBe(1)
      expect(rows[0].nextAttempt).toBeInstanceOf(Date) // retry scheduled
    } finally {
      await rx.close()
    }
  })

  test('endpoints not subscribed to the event get nothing', async () => {
    const rx = await startReceiver(() => 200)
    try {
      const store = new InMemoryWebhookStore()
      await store.createEndpoint({ installationId: 'inst_e2e', url: rx.url, events: ['review.updated'] })

      const rows = await dispatchEvent(store, {
        installationId: 'inst_e2e',
        event: 'review.created',
        review: REVIEW,
        occurredAtIso: '2026-07-15T12:00:00.000Z',
      })

      expect(rows).toHaveLength(0)
      expect(rx.received).toHaveLength(0)
    } finally {
      await rx.close()
    }
  })
})
