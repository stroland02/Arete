import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function mockPrisma(installation: any = null) {
  vi.doMock('@arete/db', () => {
    const PrismaClient = vi.fn()
    PrismaClient.prototype.installation = {
      findUnique: vi.fn().mockResolvedValue(installation),
    }
    PrismaClient.prototype.repository = {
      findFirst: vi.fn().mockResolvedValue({ id: 'repo-1' }),
    }
    PrismaClient.prototype.agentMemory = {
      create: vi.fn().mockResolvedValue({}),
    }
    return { PrismaClient }
  })
}

function makeOctokit(parentComment: { userType: string; body: string } | null = null) {
  const getReviewComment = parentComment
    ? vi.fn().mockResolvedValue({
        data: { user: { type: parentComment.userType }, body: parentComment.body },
      })
    : vi.fn().mockRejectedValue(new Error('Not Found'))
  const createReplyForReviewComment = vi.fn().mockResolvedValue({})
  return {
    octokit: { rest: { pulls: { getReviewComment, createReplyForReviewComment } } },
    getReviewComment,
    createReplyForReviewComment,
  }
}

function makePayload(overrides: { in_reply_to_id?: number; installation?: { id: number } } = {}) {
  return {
    action: 'created',
    comment: {
      id: 42,
      body: 'Why is this a problem?',
      user: { type: 'User', login: 'dev1' },
      in_reply_to_id: overrides.in_reply_to_id,
      diff_hunk: '@@ -1 +1 @@',
      path: 'src/app.ts',
    },
    pull_request: { number: 7, title: 'Add feature', body: 'desc' },
    repository: { owner: { login: 'acme' }, name: 'api' },
    installation: overrides.installation,
  }
}

describe('handleReviewCommentEvent', () => {
  const originalFetch = global.fetch

  beforeEach(() => { vi.resetModules() })
  afterEach(() => {
    global.fetch = originalFetch
    vi.unstubAllGlobals()
  })

  it('does NOT run the chat pipeline for a top-level comment (no in_reply_to_id) — regression for Bug A', async () => {
    mockPrisma()
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const { octokit, getReviewComment, createReplyForReviewComment } = makeOctokit()

    const { handleReviewCommentEvent } = await import('./chat-handler.js')
    await handleReviewCommentEvent(octokit as any, makePayload({ installation: { id: 777 } }) as any)

    expect(getReviewComment).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(createReplyForReviewComment).not.toHaveBeenCalled()
  })

  it('does NOT run the chat pipeline when the parent comment was not written by the bot', async () => {
    mockPrisma()
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const { octokit, createReplyForReviewComment } = makeOctokit({ userType: 'User', body: 'a human comment' })

    const { handleReviewCommentEvent } = await import('./chat-handler.js')
    await handleReviewCommentEvent(
      octokit as any,
      makePayload({ in_reply_to_id: 41, installation: { id: 777 } }) as any
    )

    expect(mockFetch).not.toHaveBeenCalled()
    expect(createReplyForReviewComment).not.toHaveBeenCalled()
  })

  it('does NOT run the chat pipeline when the installation is billing-gated (Bug B) and posts an upgrade reply', async () => {
    mockPrisma({ id: 'inst-1', subscriptionStatus: 'trialing', usageCount: 50 })
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const { octokit, createReplyForReviewComment } = makeOctokit({ userType: 'Bot', body: 'Areté: consider X' })

    const { handleReviewCommentEvent } = await import('./chat-handler.js')
    await handleReviewCommentEvent(
      octokit as any,
      makePayload({ in_reply_to_id: 41, installation: { id: 777 } }) as any
    )

    expect(mockFetch).not.toHaveBeenCalled()
    expect(createReplyForReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('upgrade') })
    )
  })

  it('runs the chat pipeline and posts the reply for a valid reply to a bot comment (happy path)', async () => {
    mockPrisma({ id: 'inst-1', subscriptionStatus: 'trialing', usageCount: 5 })
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ reply: 'Because it can leak memory.', actions: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)
    const { octokit, createReplyForReviewComment } = makeOctokit({ userType: 'Bot', body: 'Areté: consider X' })

    const { handleReviewCommentEvent } = await import('./chat-handler.js')
    await handleReviewCommentEvent(
      octokit as any,
      makePayload({ in_reply_to_id: 41, installation: { id: 777 } }) as any
    )

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/chat'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(createReplyForReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Because it can leak memory.' })
    )
  })
})

describe('runChatPipeline', () => {
  const originalFetch = global.fetch

  beforeEach(() => { vi.resetModules() })
  afterEach(() => { global.fetch = originalFetch })

  it('rejects with a timeout error when the Python /chat endpoint hangs (Bug C)', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      if (options && (options as any).signal) {
        (options as any).signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }
    })) as any

    const { runChatPipeline } = await import('./chat-handler.js')
    const promise = runChatPipeline({ user_reply: 'hi' })

    vi.advanceTimersByTime(120_001)
    await expect(promise).rejects.toThrow('timed out')
    vi.useRealTimers()
  })
})
