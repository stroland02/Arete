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

  it('GET /api/webhooks/endpoints is mounted — 400 without installationId, not 404', async () => {
    // 400 (validation) proves the outbound-webhook router is reachable; a 404
    // would mean it was never mounted. DB-free: validation precedes any store call.
    const res = await request(app).get('/api/webhooks/endpoints')
    expect(res.status).toBe(400)
  })
})

describe('POST /api/approvals/:id/execute route wiring', () => {
  beforeEach(() => { vi.resetModules() })

  async function buildWith(executeApproval: (id: string) => Promise<any>): Promise<Application> {
    vi.doMock('@arete/db', () => ({ PrismaClient: vi.fn() }))
    vi.doMock('./approval-handler.js', () => ({ executeApproval }))
    const { createServer } = await import('./server.js')
    return createServer()
  }

  it('returns 202 and the executed state when the approval is newly executed', async () => {
    const executedAt = new Date('2026-07-14T00:00:00Z')
    const execute = vi.fn().mockResolvedValue({ outcome: 'executed', approvalId: 'a1', executedAt })
    const app = await buildWith(execute)

    const res = await request(app).post('/api/approvals/a1/execute').send({})

    expect(execute).toHaveBeenCalledWith('a1')
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ status: 'executed', approvalId: 'a1' })
  })

  it('returns 404 when the approval does not exist', async () => {
    const execute = vi.fn().mockResolvedValue({ outcome: 'not_found' })
    const app = await buildWith(execute)

    const res = await request(app).post('/api/approvals/nope/execute').send({})

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ error: 'approval_not_found' })
  })

  it('returns 200 idempotent on replay of an already-executed approval', async () => {
    const executedAt = new Date('2026-07-14T00:00:00Z')
    const execute = vi.fn().mockResolvedValue({ outcome: 'already_executed', approvalId: 'a1', executedAt })
    const app = await buildWith(execute)

    const res = await request(app).post('/api/approvals/a1/execute').send({})

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'executed', idempotent: true })
  })

  it('returns 409 when the approval was rejected', async () => {
    const execute = vi.fn().mockResolvedValue({ outcome: 'rejected', status: 'REJECTED' })
    const app = await buildWith(execute)

    const res = await request(app).post('/api/approvals/a1/execute').send({})

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'approval_rejected' })
  })
})
