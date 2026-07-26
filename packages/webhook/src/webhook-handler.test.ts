import { describe, it, expect, vi, beforeEach } from 'vitest'

function mockPrisma(overrides: { installation?: any; repository?: any; review?: any } = {}) {
  vi.doMock('@arete/db', () => {
    const PrismaClient = vi.fn()
    PrismaClient.prototype.installation = {
      findUnique: vi.fn().mockResolvedValue(overrides.installation ?? null),
    }
    PrismaClient.prototype.repository = {
      findUnique: vi.fn().mockResolvedValue(overrides.repository ?? null),
    }
    PrismaClient.prototype.review = {
      findUnique: vi.fn().mockResolvedValue(overrides.review ?? null),
    }
    return { PrismaClient }
  })
}

describe('handlePullRequestEvent', () => {
  beforeEach(() => { vi.resetModules() })

  it('enqueues a review-pr job and returns without waiting for the pipeline (async handoff)', async () => {
    mockPrisma()
    const mockEnqueue = vi.fn().mockResolvedValue(undefined)
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({} as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'abcdef' } },
      installation: { id: 777 },
      action: 'opened',
    })

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'github',
        kind: 'pull_request',
        owner: 'acme',
        repo: 'api',
        prNumber: 1,
        installationId: 777,
        headSha: 'abcdef',
        repositoryExternalId: 123,
      }),
      'fast',
    )
  })

  it('routes a >50-changed-file PR to the heavy lane (a queue a running Worker must consume — see worker.test.ts)', async () => {
    mockPrisma()
    const mockEnqueue = vi.fn().mockResolvedValue(undefined)
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({} as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'abcdef' }, changed_files: 51 },
      installation: { id: 777 },
      action: 'opened',
    })

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ prNumber: 1 }), 'heavy')
  })

  it('does not enqueue for closed PRs', async () => {
    mockPrisma()
    const mockEnqueue = vi.fn()
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({} as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'abcdef' } },
      action: 'closed',
    })

    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('skips enqueueing when a completed review already exists for this head SHA (duplicate delivery)', async () => {
    mockPrisma({
      repository: { id: 'repo-uuid-1', provider: 'github', externalId: 123 },
      review: { id: 'review-uuid-1', repositoryId: 'repo-uuid-1', prNumber: 1, headSha: 'abcdef' },
    })
    const mockEnqueue = vi.fn()
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({} as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'abcdef' } },
      installation: { id: 777 },
      action: 'synchronize',
    })

    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('still enqueues a job for a different head SHA on the same PR (new commit, not a duplicate)', async () => {
    mockPrisma({
      repository: { id: 'repo-uuid-1', provider: 'github', externalId: 123 },
      review: null, // findUnique keyed on (repositoryId, prNumber, headSha) — new SHA has no row
    })
    const mockEnqueue = vi.fn().mockResolvedValue(undefined)
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({} as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'newsha456' } },
      installation: { id: 777 },
      action: 'synchronize',
    })

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })

  it('posts a "paused" comment and skips enqueueing when the subscription is inactive', async () => {
    mockPrisma({
      installation: { id: 'inst-1', provider: 'github', externalId: 777, subscriptionStatus: 'canceled' },
    })
    const mockEnqueue = vi.fn()
    const mockRequest = vi.fn().mockResolvedValue({})
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({ request: mockRequest } as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'abcdef' } },
      installation: { id: 777 },
      action: 'opened',
    })

    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
      expect.objectContaining({ body: expect.stringContaining('paused') })
    )
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('blocks the review and posts an upgrade comment when the 50-review free tier is exhausted', async () => {
    mockPrisma({
      installation: {
        id: 'inst-1', provider: 'github', externalId: 777,
        subscriptionStatus: 'trialing', usageCount: 50,
      },
    })
    const mockEnqueue = vi.fn()
    const mockRequest = vi.fn().mockResolvedValue({})
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({ request: mockRequest } as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'abcdef' } },
      installation: { id: 777 },
      action: 'opened',
    })

    // Upgrade prompt is posted, and the LLM pipeline is never enqueued
    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
      expect.objectContaining({ body: expect.stringContaining('50 free') })
    )
    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
      expect.objectContaining({ body: expect.stringContaining('upgrade') })
    )
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('still enqueues normally when the installation is under the free-tier limit (regression guard)', async () => {
    mockPrisma({
      installation: {
        id: 'inst-1', provider: 'github', externalId: 777,
        subscriptionStatus: 'trialing', usageCount: 49,
      },
    })
    const mockEnqueue = vi.fn().mockResolvedValue(undefined)
    const mockRequest = vi.fn()
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({ request: mockRequest } as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'abcdef' } },
      installation: { id: 777 },
      action: 'opened',
    })

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('still enqueues for a paying customer even past 50 reviews (paid plans have no PR cap)', async () => {
    mockPrisma({
      installation: {
        id: 'inst-1', provider: 'github', externalId: 777,
        subscriptionStatus: 'active', usageCount: 500,
      },
    })
    const mockEnqueue = vi.fn().mockResolvedValue(undefined)
    const mockRequest = vi.fn()
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({ request: mockRequest } as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'abcdef' } },
      installation: { id: 777 },
      action: 'opened',
    })

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockRequest).not.toHaveBeenCalled()
  })
})

describe('registerCheckRunWebhooks', () => {
  beforeEach(() => { vi.resetModules() })

  function makeApp() {
    const handlers: Record<string, (...args: any[]) => any> = {}
    return {
      app: {
        webhooks: {
          on: (event: string, handler: (...args: any[]) => any) => { handlers[event] = handler },
        },
      },
      handlers,
    }
  }

  it("does NOT enqueue a job for check_run.completed on Areté's OWN check run (regression: self-trigger loop)", async () => {
    mockPrisma()
    const mockEnqueue = vi.fn()
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { registerCheckRunWebhooks } = await import('./webhook-handler.js')
    const { app, handlers } = makeApp()
    registerCheckRunWebhooks(app)

    await handlers['check_run.completed']({
      octokit: {},
      payload: {
        check_run: {
          name: 'Areté AI Code Review',
          conclusion: 'failure',
          head_sha: 'abcdef',
          pull_requests: [{ number: 1 }],
        },
        repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
        installation: { id: 777 },
      },
    })

    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it("DOES enqueue a CI-diagnosis job for a DIFFERENT check run (customer's real CI failing)", async () => {
    mockPrisma()
    const mockEnqueue = vi.fn().mockResolvedValue(undefined)
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { registerCheckRunWebhooks } = await import('./webhook-handler.js')
    const { app, handlers } = makeApp()
    registerCheckRunWebhooks(app)

    await handlers['check_run.completed']({
      octokit: {},
      payload: {
        check_run: {
          name: 'CI / build',
          conclusion: 'failure',
          head_sha: 'abcdef',
          pull_requests: [{ number: 1 }],
          output: { text: 'build failed: exit code 1' },
        },
        repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
        installation: { id: 777 },
      },
    })

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'github',
        kind: 'check_run',
        owner: 'acme',
        repo: 'api',
        prNumber: 1,
        headSha: 'abcdef',
        installationId: 777,
        ciLogs: 'build failed: exit code 1',
      })
    )
  })

  it('does not enqueue when the (non-own) check run succeeded rather than failed', async () => {
    mockPrisma()
    const mockEnqueue = vi.fn()
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const { registerCheckRunWebhooks } = await import('./webhook-handler.js')
    const { app, handlers } = makeApp()
    registerCheckRunWebhooks(app)

    await handlers['check_run.completed']({
      octokit: {},
      payload: {
        check_run: {
          name: 'CI / build',
          conclusion: 'success',
          head_sha: 'abcdef',
          pull_requests: [{ number: 1 }],
        },
        repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
        installation: { id: 777 },
      },
    })

    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
