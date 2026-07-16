import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createStagingSendHandler } from './send-handler.js'
import type { StagingSendDeps, StagingSendResult } from './send.js'

// The Express adapter for POST /staging/send. It validates the { containerId,
// installationId } body, delegates to runStagingSend, and maps the flat outcome
// to an HTTP status the dashboard action can rely on:
//   opened | already_open -> 200,  not_approved -> 409,  failed -> 502,
//   malformed body        -> 400.
// The runner is injected so this exercises only the HTTP concern (validation +
// status mapping) — the orchestration itself is covered in send.test.ts.

// deps are never touched here (the runner is faked), so an empty object cast is fine.
const deps = {} as StagingSendDeps

function appWith(
  run: (deps: StagingSendDeps, input: { containerId: string; installationId: string }) => Promise<StagingSendResult>,
) {
  const app = express()
  app.post('/staging/send', express.json(), createStagingSendHandler(deps, run as never))
  return app
}

describe('POST /staging/send handler', () => {
  it('400s a body missing containerId or installationId, and never runs the send', async () => {
    const run = vi.fn()
    const app = appWith(run)

    const res = await request(app).post('/staging/send').send({ installationId: 'inst_1' })

    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('passes the body through to the runner and returns 200 with the PR on opened', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ outcome: 'opened', prNumber: 42, prUrl: 'https://github.com/acme/web/pull/42' })
    const app = appWith(run)

    const res = await request(app).post('/staging/send').send({ containerId: 'cont_abc', installationId: 'inst_1' })

    expect(run).toHaveBeenCalledWith(deps, { containerId: 'cont_abc', installationId: 'inst_1' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ outcome: 'opened', prNumber: 42, prUrl: 'https://github.com/acme/web/pull/42' })
  })

  it('returns 200 on already_open (idempotent replay is success, not an error)', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ outcome: 'already_open', prNumber: 7, prUrl: 'https://github.com/acme/web/pull/7' })
    const res = await request(appWith(run)).post('/staging/send').send({ containerId: 'c', installationId: 'i' })

    expect(res.status).toBe(200)
    expect(res.body.outcome).toBe('already_open')
  })

  it('returns 409 on not_approved (the gate refused — a precondition, not a failure)', async () => {
    const run = vi.fn().mockResolvedValue({ outcome: 'not_approved' })
    const res = await request(appWith(run)).post('/staging/send').send({ containerId: 'c', installationId: 'i' })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ outcome: 'not_approved' })
  })

  it('returns 502 with the detail on failed (upstream/resolution error)', async () => {
    const run = vi.fn().mockResolvedValue({ outcome: 'failed', detail: '502 upstream' })
    const res = await request(appWith(run)).post('/staging/send').send({ containerId: 'c', installationId: 'i' })

    expect(res.status).toBe(502)
    expect(res.body).toEqual({ outcome: 'failed', detail: '502 upstream' })
  })
})
