// Standalone end-to-end drive of the outbound webhook path against a LIVE local
// receiver, printing the actual delivery record at each step. Run:
//
//   pnpm --filter @arete/webhook exec tsx scripts/webhook-e2e-drive.ts
//
// Uses the in-memory store (no Postgres needed) so the full register → fire →
// signed delivery → recorded row → retry flow is demonstrable anywhere. The
// Prisma-backed store is the production persistence (see the runbook); this
// script proves the transport, signing, recording and retry logic for real.

import { createServer, type Server } from 'node:http'
import { dispatchEvent } from '../src/outbound/dispatch.js'
import { verifyWebhookSignature } from '../src/outbound/signature.js'
import { InMemoryWebhookStore } from '../src/outbound/store.js'

process.env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS = '1'

interface Receiver {
  url: string
  state: { secret: string; verified: boolean; received: number }
  close: () => Promise<void>
}

function startReceiver(status: number): Promise<Receiver> {
  const state = { secret: '', verified: false, received: 0 }
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      state.received += 1
      state.verified = verifyWebhookSignature(state.secret, String(req.headers['arete-signature']), body)
      res.statusCode = status
      res.end('ok')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/hook`,
        state,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

const REVIEW = { id: 'rev_demo', prNumber: 128, repositoryFullName: 'acme/rocket', riskLevel: 'high' }

async function main() {
  // --- Happy path: healthy receiver (returns 202) --------------------------
  const ok = await startReceiver(202)
  const store = new InMemoryWebhookStore()
  const ep = await store.createEndpoint({
    installationId: 'inst_demo',
    url: ok.url,
    events: ['review.created'],
  })
  ok.state.secret = ep.secret // receiver now knows how to verify signatures

  console.log('1) Registered endpoint:', {
    id: ep.id,
    url: ep.url,
    events: ep.events,
    secret: `${ep.secret.slice(0, 12)}…(redacted)`,
  })

  const rows = await dispatchEvent(store, {
    installationId: 'inst_demo',
    event: 'review.created',
    review: REVIEW,
    occurredAtIso: new Date().toISOString(),
  })
  console.log('2) Fired review.created → delivery record:', rows[0])
  console.log('   receiver got', ok.state.received, 'request(s); signature verified:', ok.state.verified)
  await ok.close()

  // --- Failure path: receiver returns 503 → retry scheduled ----------------
  const bad = await startReceiver(503)
  const store2 = new InMemoryWebhookStore()
  const ep2 = await store2.createEndpoint({
    installationId: 'inst_demo',
    url: bad.url,
    events: ['review.created'],
  })
  bad.state.secret = ep2.secret
  const failRows = await dispatchEvent(store2, {
    installationId: 'inst_demo',
    event: 'review.created',
    review: REVIEW,
    occurredAtIso: new Date().toISOString(),
  })
  console.log('3) Failing endpoint (503) → delivery record:', failRows[0])
  console.log('   next retry due:', failRows[0].nextAttempt?.toISOString())
  await bad.close()
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
