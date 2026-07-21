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

// SECURITY (mutation test for Global Constraint 10 — a gate never observed
// failing is not known to work): Alertmanager posts firing/resolved alerts to
// this route. It sits behind the SAME internal-token middleware /fix/trigger
// uses (server.ts requireInternalToken) — no second auth path. Alertmanager
// retries on non-2xx, so a malformed payload must still 2xx (logged, not
// persisted) while auth failure is the ONLY non-2xx outcome (task-3-brief.md).
describe('POST /alerts/incoming route wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-internal-token')
  })

  async function buildWith(handleIncomingAlert: (body: unknown) => Promise<any>): Promise<Application> {
    vi.doMock('@arete/db', () => ({ PrismaClient: vi.fn() }))
    vi.doMock('./alerting/receiver.js', () => ({ handleIncomingAlert }))
    const { createServer } = await import('./server.js')
    return createServer()
  }

  const authed = (app: Application) =>
    request(app).post('/alerts/incoming').set('Authorization', 'Bearer test-internal-token')

  it('401s a request with NO internal token and writes no row (mutation test for the gate)', async () => {
    const handleIncomingAlert = vi.fn()
    const app = await buildWith(handleIncomingAlert)

    const res = await request(app).post('/alerts/incoming').send({ alerts: [] })

    expect(res.status).toBe(401)
    expect(handleIncomingAlert).not.toHaveBeenCalled()
  })

  it('401s a request with a WRONG internal token', async () => {
    const handleIncomingAlert = vi.fn()
    const app = await buildWith(handleIncomingAlert)

    const res = await request(app)
      .post('/alerts/incoming')
      .set('Authorization', 'Bearer not-the-right-token')
      .send({ alerts: [] })

    expect(res.status).toBe(401)
    expect(handleIncomingAlert).not.toHaveBeenCalled()
  })

  it('200s and forwards the body to handleIncomingAlert for a correctly authed request', async () => {
    const handleIncomingAlert = vi.fn().mockResolvedValue({ created: 1, updated: 0 })
    const app = await buildWith(handleIncomingAlert)
    const body = { alerts: [{ status: 'firing', labels: { alertname: 'X' } }] }

    const res = await authed(app).send(body)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ created: 1, updated: 0 })
    expect(handleIncomingAlert).toHaveBeenCalledWith(body)
  })

  it('still 2xx when handleIncomingAlert unexpectedly rejects — never 500s Alertmanager into a retry loop', async () => {
    const handleIncomingAlert = vi.fn().mockRejectedValue(new Error('unexpected'))
    const app = await buildWith(handleIncomingAlert)

    const res = await authed(app).send({ alerts: [] })

    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(300)
  })

  // Review finding I4. express.json() is ROUTE middleware, so its failures
  // (body-parser 1.20.6: SyntaxError -> 400, PayloadTooLargeError -> 413)
  // bypass the handler's try/catch entirely and were answered by express
  // 4.22.2's default error handler. Alertmanager treats 4xx as PERMANENT and
  // drops the notification — the alert is lost with no retry and no row.
  describe('malformed / oversized bodies (finding I4)', () => {
    it('answers 2xx for a body that is not valid JSON (SyntaxError -> 400 without the error middleware)', async () => {
      const handleIncomingAlert = vi.fn().mockResolvedValue({ created: 0, updated: 0 })
      const app = await buildWith(handleIncomingAlert)

      const res = await authed(app).set('Content-Type', 'application/json').send('{"alerts": [')

      expect(res.status).toBeGreaterThanOrEqual(200)
      expect(res.status).toBeLessThan(300)
    })

    it('answers 2xx for an oversized body (PayloadTooLargeError -> 413 without the error middleware)', async () => {
      const handleIncomingAlert = vi.fn().mockResolvedValue({ created: 0, updated: 0 })
      const app = await buildWith(handleIncomingAlert)

      // express.json()'s default limit is 100kb.
      const huge = { alerts: [{ annotations: { description: 'x'.repeat(200_000) } }] }
      const res = await authed(app).send(huge)

      expect(res.status).toBeGreaterThanOrEqual(200)
      expect(res.status).toBeLessThan(300)
    })

    it('answers 2xx for an empty body — the pre-auth poison-message guard must not 400 this path', async () => {
      const handleIncomingAlert = vi.fn().mockResolvedValue({ created: 0, updated: 0 })
      const app = await buildWith(handleIncomingAlert)

      const res = await authed(app).set('Content-Type', 'application/json').send('')

      expect(res.status).toBeGreaterThanOrEqual(200)
      expect(res.status).toBeLessThan(300)
    })

    it('STILL 401s an unauthenticated malformed body — auth failure remains the only non-2xx', async () => {
      const handleIncomingAlert = vi.fn()
      const app = await buildWith(handleIncomingAlert)

      const res = await request(app)
        .post('/alerts/incoming')
        .set('Content-Type', 'application/json')
        .send('{"alerts": [')

      expect(res.status).toBe(401)
      expect(handleIncomingAlert).not.toHaveBeenCalled()
    })

    it('leaves OTHER routes on express default behaviour — a malformed body there is still 4xx', async () => {
      const handleIncomingAlert = vi.fn()
      const app = await buildWith(handleIncomingAlert)

      const res = await request(app)
        .post('/scan/trigger')
        .set('Authorization', 'Bearer test-internal-token')
        .set('Content-Type', 'application/json')
        .send('{"installationId": ')

      expect(res.status).toBeGreaterThanOrEqual(400)
    })
  })
})

// SECURITY (mutation test for Global Constraint 10 — Phase 2 Task 8): closes
// the add_project_memory stub (packages/agents/src/arete_agents/tools/memory.py)
// that logged and returned a hardcoded success string without persisting
// anything. This route sits behind the SAME `/internal` prefix guard as
// /internal/model-connections/test and /internal/context-map/file
// (requireInternalToken) — no second auth path. The tenant guard and size
// caps are unit-tested against a fake prisma store in memory-write.test.ts;
// these tests only cover route wiring + the auth-rejection mutation test,
// matching the split already used for /alerts/incoming and /fix/trigger.
describe('POST /internal/memory route wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-internal-token')
  })

  async function buildWith(saveAgentMemory: (params: unknown) => Promise<any>): Promise<Application> {
    vi.doMock('@arete/db', () => ({ PrismaClient: vi.fn() }))
    vi.doMock('./memory-write.js', () => ({ saveAgentMemory }))
    const { createServer } = await import('./server.js')
    return createServer()
  }

  const authed = (app: Application) =>
    request(app).post('/internal/memory').set('Authorization', 'Bearer test-internal-token')

  it('401s a request with NO internal token and writes no row (mutation test for the gate)', async () => {
    const saveAgentMemory = vi.fn()
    const app = await buildWith(saveAgentMemory)

    const res = await request(app)
      .post('/internal/memory')
      .send({ installationId: 1, repoFullName: 'owner/repo', body: 'note' })

    expect(res.status).toBe(401)
    expect(saveAgentMemory).not.toHaveBeenCalled()
  })

  it('401s a request with a WRONG internal token', async () => {
    const saveAgentMemory = vi.fn()
    const app = await buildWith(saveAgentMemory)

    const res = await request(app)
      .post('/internal/memory')
      .set('Authorization', 'Bearer not-the-right-token')
      .send({ installationId: 1, repoFullName: 'owner/repo', body: 'note' })

    expect(res.status).toBe(401)
    expect(saveAgentMemory).not.toHaveBeenCalled()
  })

  it('201s and forwards the parsed body to saveAgentMemory for a correctly authed request', async () => {
    const saveAgentMemory = vi.fn().mockResolvedValue({ ok: true, id: 'mem-1' })
    const app = await buildWith(saveAgentMemory)

    const res = await authed(app).send({
      installationId: 42,
      repoFullName: 'owner/repo',
      kind: 'infra',
      title: 'Rule',
      body: 'Always use Redis for caching.',
    })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true, id: 'mem-1' })
    expect(saveAgentMemory).toHaveBeenCalledWith({
      installationExternalId: 42,
      repoFullName: 'owner/repo',
      kind: 'infra',
      title: 'Rule',
      body: 'Always use Redis for caching.',
    })
  })

  it('maps a repo_not_found rejection (tenant guard) to 404, not a leaked distinction', async () => {
    const saveAgentMemory = vi.fn().mockResolvedValue({ ok: false, reason: 'repo_not_found' })
    const app = await buildWith(saveAgentMemory)

    const res = await authed(app).send({
      installationId: 42,
      repoFullName: 'someone-elses/repo',
      body: 'note',
    })

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ ok: false, reason: 'repo_not_found' })
  })

  it('maps an internal_error (e.g. induced transport/DB failure) to 500, never 201', async () => {
    const saveAgentMemory = vi.fn().mockResolvedValue({ ok: false, reason: 'internal_error' })
    const app = await buildWith(saveAgentMemory)

    const res = await authed(app).send({ installationId: 42, repoFullName: 'owner/repo', body: 'note' })

    expect(res.status).toBe(500)
    expect(res.body).not.toMatchObject({ ok: true })
  })

  it('500s (not 201) when saveAgentMemory unexpectedly rejects — never fabricates success', async () => {
    const saveAgentMemory = vi.fn().mockRejectedValue(new Error('unexpected'))
    const app = await buildWith(saveAgentMemory)

    const res = await authed(app).send({ installationId: 42, repoFullName: 'owner/repo', body: 'note' })

    expect(res.status).toBe(500)
    expect(res.body).not.toMatchObject({ ok: true })
  })
})
