import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Request, Response } from 'express'

interface MockRes {
  statusCode?: number
  body?: any
  status(code: number): MockRes
  send(payload: any): MockRes
}

function makeReqRes(headers: Record<string, string> = {}, body: any = {}) {
  const req = { headers, body } as unknown as Request
  const res: MockRes = {
    statusCode: undefined,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    send(payload: any) {
      this.body = payload
      return this
    },
  }
  return { req, res: res as unknown as Response, mockRes: res }
}

describe('handleGitLabWebhook', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.doMock('./generated/prisma/client.js', () => {
      const PrismaClient = vi.fn()
      PrismaClient.prototype.$transaction = vi.fn().mockResolvedValue([])
      PrismaClient.prototype.installation = { upsert: vi.fn() }
      PrismaClient.prototype.repository = { upsert: vi.fn() }
      PrismaClient.prototype.review = { create: vi.fn() }
      return { PrismaClient }
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 when X-Gitlab-Token does not match the configured secret', async () => {
    vi.stubEnv('GITLAB_WEBHOOK_SECRET', 'correct-secret')
    const { handleGitLabWebhook } = await import('./gitlab-handler.js')

    const { req, res, mockRes } = makeReqRes({ 'x-gitlab-token': 'wrong-token' })
    await handleGitLabWebhook(req, res)

    expect(mockRes.statusCode).toBe(401)
    expect(mockRes.body).toBe('Unauthorized')
  })

  it('returns 401 (fails closed) when GITLAB_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.GITLAB_WEBHOOK_SECRET
    const { handleGitLabWebhook } = await import('./gitlab-handler.js')

    const { req, res, mockRes } = makeReqRes({ 'x-gitlab-token': 'anything' })
    await handleGitLabWebhook(req, res)

    expect(mockRes.statusCode).toBe(401)
    expect(mockRes.body).toBe('Unauthorized')
  })

  it('returns 200 when the token matches the configured secret', async () => {
    vi.stubEnv('GITLAB_WEBHOOK_SECRET', 'correct-secret')
    const { handleGitLabWebhook } = await import('./gitlab-handler.js')

    const { req, res, mockRes } = makeReqRes(
      { 'x-gitlab-token': 'correct-secret' },
      { object_kind: 'note' } // not a merge_request event, so no pipeline is triggered
    )
    await handleGitLabWebhook(req, res)

    expect(mockRes.statusCode).toBe(200)
    expect(mockRes.body).toBe('OK')
  })
})
