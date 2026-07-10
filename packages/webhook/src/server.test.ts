import { describe, it, expect, beforeAll, vi } from 'vitest'
import request from 'supertest'
import type { Application } from 'express'

// Stub env before createServer() reads it
vi.stubEnv('GITHUB_APP_ID', '12345')
vi.stubEnv('GITHUB_PRIVATE_KEY', '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n')
vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-secret')
vi.stubEnv('STRIPE_SECRET_KEY', 'test_stripe_secret')
vi.stubEnv('PORT', '3000')

describe('server middleware mount', () => {
  let app: Application

  beforeAll(async () => {
    vi.doMock('@arete/db', () => {
      return { PrismaClient: vi.fn() }
    })
    const { createServer } = await import('./server.js')
    app = await createServer()
  })

  it('POST /webhook is handled (not 404) — confirms middleware is mounted at root', async () => {
    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send('{}')
    // Octokit rejects unsigned payloads with 400 or 401; 404 means the route was not found
    expect(res.status).not.toBe(404)
  })

  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
