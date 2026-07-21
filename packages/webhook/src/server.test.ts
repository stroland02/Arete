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

// The defect being fixed: /fix/trigger used to run `void driveFix(...)`
// inline on the webhook HTTP process — no queue, no concurrency cap. A burst
// of triggers could fan out into unbounded repo checkouts + LLM calls on the
// same process answering GitHub webhooks. These tests pin the replacement:
// the route enqueues a fix-drive job and ACKs 202 immediately, and the drive
// itself (driveFix) is NEVER invoked on this process.
describe('POST /fix/trigger route wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-internal-token')
  })

  async function buildWith(enqueueFixDrive: (data: { workItemId: string }) => Promise<any>): Promise<{
    app: Application
    driveFix: ReturnType<typeof vi.fn>
  }> {
    vi.doMock('@arete/db', () => ({ PrismaClient: vi.fn() }))
    const driveFix = vi.fn()
    vi.doMock('./fix/trigger.js', () => ({
      driveFix,
      defaultFixTriggerDeps: vi.fn(),
    }))
    vi.doMock('./queue.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./queue.js')>()
      return { ...actual, enqueueFixDrive }
    })
    const { createServer } = await import('./server.js')
    const app = await createServer()
    return { app, driveFix }
  }

  const authed = (app: Application, path: string) =>
    request(app).post(path).set('Authorization', 'Bearer test-internal-token')

  it('401s without the internal bearer token and never enqueues', async () => {
    const enqueueFixDrive = vi.fn()
    const { app } = await buildWith(enqueueFixDrive)

    const res = await request(app).post('/fix/trigger').send({ workItemId: 'wi-1' })

    expect(res.status).toBe(401)
    expect(enqueueFixDrive).not.toHaveBeenCalled()
  })

  it('400s when workItemId is missing, without enqueuing', async () => {
    const enqueueFixDrive = vi.fn()
    const { app } = await buildWith(enqueueFixDrive)

    const res = await authed(app, '/fix/trigger').send({})

    expect(res.status).toBe(400)
    expect(enqueueFixDrive).not.toHaveBeenCalled()
  })

  it('enqueues a fix-drive job and ACKs 202 {started:true} WITHOUT running driveFix inline', async () => {
    const enqueueFixDrive = vi.fn().mockResolvedValue({ id: 'job-1' })
    const { app, driveFix } = await buildWith(enqueueFixDrive)

    const res = await authed(app, '/fix/trigger').send({ workItemId: 'wi-1' })

    expect(res.status).toBe(202)
    expect(res.body).toEqual({ started: true })
    expect(enqueueFixDrive).toHaveBeenCalledWith({ workItemId: 'wi-1' })
    // The whole point of this task: the HTTP process enqueues, it does not drive.
    expect(driveFix).not.toHaveBeenCalled()
  })

  it('returns 500 and does not ACK 202 when enqueueing itself fails', async () => {
    const enqueueFixDrive = vi.fn().mockRejectedValue(new Error('redis unreachable'))
    const { app, driveFix } = await buildWith(enqueueFixDrive)

    const res = await authed(app, '/fix/trigger').send({ workItemId: 'wi-1' })

    expect(res.status).toBe(500)
    expect(res.body).not.toEqual({ started: true })
    expect(driveFix).not.toHaveBeenCalled()
  })
})
