import express from 'express'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createWebhookRouter } from './routes.js'
import { InMemoryWebhookStore } from './store.js'

// Real HTTP against the router, backed by the in-memory store (no DB needed).
// NOTE: we do NOT set WEBHOOK_ALLOW_PRIVATE_DESTINATIONS here, so the SSRF guard
// is live — a loopback URL must be rejected at registration. Public cases use a
// literal public IP so no DNS/network is required in the sandbox.

let server: Server
let base: string
const store = new InMemoryWebhookStore()

beforeEach(async () => {
  const app = express()
  app.use('/api/webhooks', createWebhookRouter(store))
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  base = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

const PUBLIC_URL = 'https://93.184.216.34/hook' // literal public IP → no DNS

describe('POST /api/webhooks/endpoints', () => {
  test('creates an endpoint and returns the secret exactly once', async () => {
    const res = await fetch(`${base}/api/webhooks/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationId: 'inst_r', url: PUBLIC_URL }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.secret).toMatch(/^whsec_/)
    expect(body.events).toEqual(['review.created', 'review.updated']) // default = both
    expect(body.url).toBe(PUBLIC_URL)
  })

  test('rejects a loopback URL via the SSRF guard', async () => {
    const res = await fetch(`${base}/api/webhooks/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationId: 'inst_r', url: 'http://127.0.0.1:9999/hook' }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects a missing url', async () => {
    const res = await fetch(`${base}/api/webhooks/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationId: 'inst_r' }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects an unknown event name', async () => {
    const res = await fetch(`${base}/api/webhooks/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationId: 'inst_r', url: PUBLIC_URL, events: ['review.exploded'] }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/webhooks/endpoints', () => {
  test('lists the installation endpoints WITHOUT secrets', async () => {
    await fetch(`${base}/api/webhooks/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationId: 'inst_list', url: PUBLIC_URL }),
    })

    const res = await fetch(`${base}/api/webhooks/endpoints?installationId=inst_list`)
    expect(res.status).toBe(200)
    const list = await res.json()
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(1)
    for (const ep of list) {
      expect(ep).not.toHaveProperty('secret')
    }
    expect(JSON.stringify(list)).not.toContain('whsec_')
  })

  test('requires installationId', async () => {
    const res = await fetch(`${base}/api/webhooks/endpoints`)
    expect(res.status).toBe(400)
  })
})
