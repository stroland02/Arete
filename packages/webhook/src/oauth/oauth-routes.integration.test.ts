import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

describe('OAuth routes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('GITHUB_APP_ID', '12345')
    vi.stubEnv('GITHUB_PRIVATE_KEY', 'dummy')
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'dummy')
    // stripe-handler.ts throws at import time without this (guard added in
    // 8d730b3) — same stub every other test that imports server.js uses.
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64))
  })

  it('GET /oauth/vercel/authorize redirects to the Vercel consent screen', async () => {
    const { createServer } = await import('../server.js')
    const app = await createServer()
    const res = await request(app).get('/oauth/vercel/authorize?installationId=inst-123')
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('vercel.com')
  })

  it('GET /oauth/vercel/callback with an invalid state returns 400', async () => {
    const { createServer } = await import('../server.js')
    const app = await createServer()
    const res = await request(app).get('/oauth/vercel/callback?code=x&state=garbage')
    expect(res.status).toBe(400)
  })
})
