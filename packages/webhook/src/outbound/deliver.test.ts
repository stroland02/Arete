import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { describe, expect, test } from 'vitest'
import { deliverWebhook } from './deliver.js'
import { renderWebhookPayload } from './payload.js'
import { verifyWebhookSignature } from './signature.js'

// A REAL delivery drive: net-guard's webhookFetch actually POSTs over a socket
// to a live local receiver. The SSRF guard blocks private IPs by default, so we
// flip the documented dev/test escape hatch for 127.0.0.1 — the same one
// self-hosters use to point webhooks at internal infra.
process.env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS = '1'

interface Received {
  headers: IncomingMessage['headers']
  rawBody: string
}

// A controllable receiver: `respond` decides the status code per request.
function startReceiver(respond: () => number): Promise<{
  url: string
  received: Received[]
  close: () => Promise<void>
}> {
  const received: Received[] = []
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      received.push({ headers: req.headers, rawBody: body })
      res.statusCode = respond()
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

const ENDPOINT = { id: 'wep_1', url: '', secret: 'whsec_deliver_test_secret' }
const PAYLOAD = renderWebhookPayload({
  event: 'review.created',
  review: { id: 'rev_9', prNumber: 7, repositoryFullName: 'acme/rocket', riskLevel: 'low' },
  occurredAtIso: '2026-07-15T12:00:00.000Z',
})

describe('deliverWebhook — real HTTP', () => {
  test('a 2xx receiver marks the delivery delivered and can verify the signature', async () => {
    const rx = await startReceiver(() => 200)
    try {
      const outcome = await deliverWebhook({ ...ENDPOINT, url: rx.url }, PAYLOAD, 'del_abc')

      expect(outcome.status).toBe('delivered')
      expect(outcome.code).toBe(200)
      expect(outcome.attempts).toBe(1)
      expect(outcome.nextAttemptMs).toBeNull()

      // The receiver actually got it, with the right headers…
      expect(rx.received).toHaveLength(1)
      const got = rx.received[0]
      expect(got.headers['arete-event']).toBe('review.created')
      expect(got.headers['arete-delivery']).toBe('del_abc')

      // …and the signature verifies against the exact bytes it received.
      const sig = got.headers['arete-signature'] as string
      expect(verifyWebhookSignature(ENDPOINT.secret, sig, got.rawBody)).toBe(true)
      // wrong secret must NOT verify
      expect(verifyWebhookSignature('whsec_wrong', sig, got.rawBody)).toBe(false)
    } finally {
      await rx.close()
    }
  })

  test('a 500 schedules a retry using the backoff curve', async () => {
    const rx = await startReceiver(() => 500)
    try {
      const outcome = await deliverWebhook({ ...ENDPOINT, url: rx.url }, PAYLOAD, 'del_500')
      expect(outcome.status).toBe('pending')
      expect(outcome.code).toBe(500)
      expect(outcome.attempts).toBe(1)
      expect(outcome.nextAttemptMs).toBe(30_000) // first retry gap
    } finally {
      await rx.close()
    }
  })

  test('the final attempt failing marks the delivery permanently failed', async () => {
    const rx = await startReceiver(() => 500)
    try {
      // 7 attempts already made → this is the 8th and last
      const outcome = await deliverWebhook({ ...ENDPOINT, url: rx.url }, PAYLOAD, 'del_last', {
        attemptsMade: 7,
      })
      expect(outcome.attempts).toBe(8)
      expect(outcome.status).toBe('failed')
      expect(outcome.nextAttemptMs).toBeNull()
    } finally {
      await rx.close()
    }
  })

  test('a connection error is a retryable failure, not a throw', async () => {
    // Nothing is listening on this port.
    const outcome = await deliverWebhook(
      { ...ENDPOINT, url: 'http://127.0.0.1:1/hook' },
      PAYLOAD,
      'del_conn',
    )
    expect(outcome.status).toBe('pending')
    expect(outcome.code).toBeNull()
    expect(outcome.error).toBeTruthy()
    expect(outcome.attempts).toBe(1)
  })
})
