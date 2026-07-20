import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
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

  // SECURITY (auth-CRITICAL, cross-tenant): the outbound-webhook management API
  // trusted a client-supplied installationId with NO authentication, so any
  // anonymous caller could register a webhook for — or list the endpoints of —
  // an arbitrary tenant, and the create response handed back that tenant's
  // whsec_ signing secret. The unauthenticated route must NOT ship: it is
  // removed from the public webhook service entirely (authenticated,
  // tenant-scoped management is a dashboard fast-follow). These assertions are
  // adversarial — an attacker probing another tenant must hit a 404 wall and
  // never receive a secret.
  it('does NOT expose GET /api/webhooks/endpoints (no unauth cross-tenant read)', async () => {
    const res = await request(app).get('/api/webhooks/endpoints?installationId=victim-tenant')
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain('whsec_')
  })

  it('does NOT expose POST /api/webhooks/endpoints (no unauth cross-tenant create / secret leak)', async () => {
    const res = await request(app)
      .post('/api/webhooks/endpoints')
      .set('Content-Type', 'application/json')
      .send({ installationId: 'victim-tenant', url: 'https://93.184.216.34/attacker-hook' })
    expect(res.status).toBe(404)
    expect(res.text).not.toContain('whsec_')
  })
})

describe('POST /api/approvals/:id/execute route wiring', () => {
  // The route sits behind the shared internal bearer guard (PM ruling
  // 2026-07-19) — provision the token and send it on legitimate calls.
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-internal-token')
  })

  async function buildWith(executeApproval: (id: string) => Promise<any>): Promise<Application> {
    vi.doMock('@arete/db', () => ({ PrismaClient: vi.fn() }))
    vi.doMock('./approval-handler.js', () => ({ executeApproval }))
    const { createServer } = await import('./server.js')
    return createServer()
  }

  const authed = (app: Application, path: string) =>
    request(app).post(path).set('Authorization', 'Bearer test-internal-token')

  it('401s without the internal bearer token and never runs the approval', async () => {
    const execute = vi.fn()
    const app = await buildWith(execute)

    const res = await request(app).post('/api/approvals/a1/execute').send({})

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'unauthorized' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('returns 202 and the executed state when the approval is newly executed', async () => {
    const executedAt = new Date('2026-07-14T00:00:00Z')
    const execute = vi.fn().mockResolvedValue({ outcome: 'executed', approvalId: 'a1', executedAt })
    const app = await buildWith(execute)

    const res = await authed(app, '/api/approvals/a1/execute').send({})

    expect(execute).toHaveBeenCalledWith('a1')
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ status: 'executed', approvalId: 'a1' })
  })

  it('returns 404 when the approval does not exist', async () => {
    const execute = vi.fn().mockResolvedValue({ outcome: 'not_found' })
    const app = await buildWith(execute)

    const res = await authed(app, '/api/approvals/nope/execute').send({})

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ error: 'approval_not_found' })
  })

  it('returns 200 idempotent on replay of an already-executed approval', async () => {
    const executedAt = new Date('2026-07-14T00:00:00Z')
    const execute = vi.fn().mockResolvedValue({ outcome: 'already_executed', approvalId: 'a1', executedAt })
    const app = await buildWith(execute)

    const res = await authed(app, '/api/approvals/a1/execute').send({})

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'executed', idempotent: true })
  })

  it('returns 409 when the approval was rejected', async () => {
    const execute = vi.fn().mockResolvedValue({ outcome: 'rejected', status: 'REJECTED' })
    const app = await buildWith(execute)

    const res = await authed(app, '/api/approvals/a1/execute').send({})

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'approval_rejected' })
  })
})
