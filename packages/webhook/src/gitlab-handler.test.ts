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

const MR_PAYLOAD = {
  object_kind: 'merge_request',
  project: { id: 555, path_with_namespace: 'acme/gitlab-api' },
  object_attributes: {
    iid: 5,
    state: 'opened',
    action: 'open',
    title: 'Add rate limiter',
    diff_refs: { base_sha: 'basesha1', start_sha: 'startsha1' },
    last_commit: { id: 'headsha1' },
  },
}

function mockPersistenceAndQueue(overrides: { reviewExists?: boolean } = {}) {
  const mockEnqueue = vi.fn().mockResolvedValue(undefined)
  const mockReviewExists = vi.fn().mockResolvedValue(overrides.reviewExists ?? false)
  vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))
  vi.doMock('./persistence.js', () => ({ reviewExists: mockReviewExists }))
  return { mockEnqueue, mockReviewExists }
}

describe('handleGitLabWebhook', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 when X-Gitlab-Token does not match the configured secret', async () => {
    mockPersistenceAndQueue()
    vi.stubEnv('GITLAB_WEBHOOK_SECRET', 'correct-secret')
    const { handleGitLabWebhook } = await import('./gitlab-handler.js')

    const { req, res, mockRes } = makeReqRes({ 'x-gitlab-token': 'wrong-token' })
    await handleGitLabWebhook(req, res)

    expect(mockRes.statusCode).toBe(401)
    expect(mockRes.body).toBe('Unauthorized')
  })

  it('returns 401 (fails closed) when GITLAB_WEBHOOK_SECRET is not configured', async () => {
    mockPersistenceAndQueue()
    delete process.env.GITLAB_WEBHOOK_SECRET
    const { handleGitLabWebhook } = await import('./gitlab-handler.js')

    const { req, res, mockRes } = makeReqRes({ 'x-gitlab-token': 'anything' })
    await handleGitLabWebhook(req, res)

    expect(mockRes.statusCode).toBe(401)
    expect(mockRes.body).toBe('Unauthorized')
  })

  it('returns 200 when the token matches the configured secret', async () => {
    mockPersistenceAndQueue()
    vi.stubEnv('GITLAB_WEBHOOK_SECRET', 'correct-secret')
    const { handleGitLabWebhook } = await import('./gitlab-handler.js')

    const { req, res, mockRes } = makeReqRes(
      { 'x-gitlab-token': 'correct-secret' },
      { object_kind: 'note' } // not a merge_request event, so no job is enqueued
    )
    await handleGitLabWebhook(req, res)

    expect(mockRes.statusCode).toBe(200)
    expect(mockRes.body).toBe('OK')
  })

  it('enqueues a review-pr job for a valid merge_request event and returns 200 immediately', async () => {
    const { mockEnqueue } = mockPersistenceAndQueue()
    vi.stubEnv('GITLAB_WEBHOOK_SECRET', 'correct-secret')
    const { handleGitLabWebhook } = await import('./gitlab-handler.js')

    const { req, res, mockRes } = makeReqRes({ 'x-gitlab-token': 'correct-secret' }, MR_PAYLOAD)
    await handleGitLabWebhook(req, res)

    expect(mockRes.statusCode).toBe(200)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gitlab',
        kind: 'merge_request',
        projectId: 555,
        mrIid: 5,
      })
    )
  })

  it('skips enqueueing a duplicate job when a review already exists for this head SHA', async () => {
    const { mockEnqueue } = mockPersistenceAndQueue({ reviewExists: true })
    vi.stubEnv('GITLAB_WEBHOOK_SECRET', 'correct-secret')
    const { handleGitLabWebhook } = await import('./gitlab-handler.js')

    const { req, res, mockRes } = makeReqRes({ 'x-gitlab-token': 'correct-secret' }, MR_PAYLOAD)
    await handleGitLabWebhook(req, res)

    expect(mockRes.statusCode).toBe(200)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
