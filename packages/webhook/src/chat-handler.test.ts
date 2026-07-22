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
    // saveAgentMemory does its count/archive/create in one serializable
    // transaction; without this the call falls through to the REAL client and
    // the write silently never lands.
    PrismaClient.prototype.$transaction = vi.fn(async (fn: any) => fn(PrismaClient.prototype))
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

// TENANCY mutation tests for the chat-side memory sink (review finding B6).
// This path created AgentMemory rows via
// `prisma.repository.findFirst({ where: { fullName } })` with NO
// installationId scoping and no size or row cap — so two installations with
// identically-named repos collide and the FIRST matching row wins, letting a
// chat reply in one tenant write a memory into another tenant's repo. Those
// rows are re-injected into that tenant's future review prompts
// (fetchProjectMemories -> base.py), so this is the same amplification the
// new /internal/memory endpoint was built to contain. Both sinks must now go
// through the ONE guarded write path, memory-write.ts::saveAgentMemory.
function mockTenantAwarePrisma(opts: {
  installations: Array<{ id: string; externalId: number; subscriptionStatus?: string; usageCount?: number }>
  repositories: Array<{ id: string; installationId: string; fullName: string }>
}) {
  const created: any[] = []
  const findFirst = vi.fn(async (args: any) => {
    const where = args?.where ?? {}
    return (
      opts.repositories.find(
        (r) =>
          r.fullName === where.fullName &&
          (where.installationId === undefined || r.installationId === where.installationId)
      ) ?? null
    )
  })
  vi.doMock('@arete/db', () => {
    const PrismaClient = vi.fn()
    PrismaClient.prototype.installation = {
      findUnique: vi.fn(async (args: any) => {
        const externalId = args?.where?.provider_externalId?.externalId
        return (
          opts.installations.find((i) => i.externalId === externalId) ?? null
        )
      }),
    }
    PrismaClient.prototype.repository = { findFirst }
    PrismaClient.prototype.agentMemory = {
      count: vi.fn().mockResolvedValue(0),
      // Below the cap, so the FIFO archive branch never runs here and
      // findMany/updateMany are not needed for this sink's assertions.
      create: vi.fn(async (args: any) => {
        created.push(args.data)
        return { id: `mem-${created.length}` }
      }),
    }
    PrismaClient.prototype.$transaction = vi.fn(async (fn: any) => fn(PrismaClient.prototype))
    return { PrismaClient }
  })
  return { created, findFirst }
}

function chatFetchReturning(actions: any[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ reply: 'ok', actions }),
  })
}

describe('handleReviewCommentEvent memory actions', () => {
  const originalFetch = global.fetch

  beforeEach(() => { vi.resetModules() })
  afterEach(() => {
    global.fetch = originalFetch
    vi.unstubAllGlobals()
  })

  const INST_A = { id: 'inst-a', externalId: 777, subscriptionStatus: 'trialing', usageCount: 5 }
  const INST_B = { id: 'inst-b', externalId: 888, subscriptionStatus: 'trialing', usageCount: 5 }
  // Same fullName under two different installations — the collision the
  // unscoped findFirst could not tell apart. Installation B's row is listed
  // FIRST so an unscoped `findFirst({ fullName })` picks the victim's.
  const REPO_B = { id: 'repo-b', installationId: INST_B.id, fullName: 'acme/api' }
  const REPO_A = { id: 'repo-a', installationId: INST_A.id, fullName: 'acme/api' }

  it('never writes a memory into another installation\'s identically-named repo', async () => {
    const { created } = mockTenantAwarePrisma({
      installations: [INST_A, INST_B],
      repositories: [REPO_B, REPO_A],
    })
    vi.stubGlobal('fetch', chatFetchReturning([
      { type: 'save_memory', kind: 'terminology', title: 'T', body: 'Use tabs.' },
    ]))
    const { octokit } = makeOctokit({ userType: 'Bot', body: 'Areté: consider X' })

    const { handleReviewCommentEvent } = await import('./chat-handler.js')
    await handleReviewCommentEvent(
      octokit as any,
      makePayload({ in_reply_to_id: 41, installation: { id: INST_A.externalId } }) as any
    )

    expect(created).toHaveLength(1)
    expect(created[0].repositoryId).toBe(REPO_A.id)
    expect(created.some((d) => d.repositoryId === REPO_B.id)).toBe(false)
  })

  it('writes nothing at all when the webhook payload carries no installation', async () => {
    const { created } = mockTenantAwarePrisma({
      installations: [INST_A, INST_B],
      repositories: [REPO_B, REPO_A],
    })
    vi.stubGlobal('fetch', chatFetchReturning([
      { type: 'save_memory', kind: 'terminology', title: 'T', body: 'Use tabs.' },
    ]))
    const { octokit } = makeOctokit({ userType: 'Bot', body: 'Areté: consider X' })

    const { handleReviewCommentEvent } = await import('./chat-handler.js')
    await handleReviewCommentEvent(
      octokit as any,
      makePayload({ in_reply_to_id: 41 }) as any
    )

    // Unscoped, this found REPO_B by fullName alone and wrote into it with no
    // tenant identity present at all.
    expect(created).toHaveLength(0)
  })

  it('scrubs and size-caps chat-authored memories to the same standard as the endpoint', async () => {
    const { created } = mockTenantAwarePrisma({
      installations: [INST_A],
      repositories: [REPO_A],
    })
    vi.stubGlobal('fetch', chatFetchReturning([
      { type: 'save_memory', kind: 'terminology', title: 'T', body: 'key is ghp_CCCCCCCCCCCCCCCCCCCC' },
      { type: 'save_memory', kind: 'terminology', title: 'T2', body: 'x'.repeat(80_000) },
    ]))
    const { octokit } = makeOctokit({ userType: 'Bot', body: 'Areté: consider X' })

    const { handleReviewCommentEvent } = await import('./chat-handler.js')
    await handleReviewCommentEvent(
      octokit as any,
      makePayload({ in_reply_to_id: 41, installation: { id: INST_A.externalId } }) as any
    )

    expect(created).toHaveLength(1) // the 80,000-char body was rejected, not stored
    expect(created[0].body).not.toContain('ghp_CCCCCCCCCCCCCCCCCCCC')
    expect(created[0].body).toContain('[REDACTED]')
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
    // Attach the rejection assertion BEFORE advancing timers: internalAuthHeaders()
    // is now async, so the mocked fetch() call — and the abort listener it
    // registers — no longer happens synchronously. advanceTimersByTimeAsync
    // flushes pending microtasks between ticks so the listener is attached
    // before the abort timer fires, but if the assertion below were only
    // attached AFTER advancing (rather than subscribed here first), the
    // promise could settle before anything is listening and Node would
    // report an unhandled rejection.
    const assertion = expect(promise).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(120_001)
    await assertion
    vi.useRealTimers()
  })
})
