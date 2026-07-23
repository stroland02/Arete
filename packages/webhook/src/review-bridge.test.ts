import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const MOCK_RESULT = {
  pr_context: { repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] },
  file_reviews: [],
  overall_summary: 'No issues.',
  risk_level: 'low',
  total_comments: 0,
}

describe('runReviewPipeline', () => {
  const originalFetch = global.fetch

  beforeEach(() => { vi.resetModules() })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns parsed ReviewResult on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_RESULT)
    }) as any

    const { runReviewPipeline } = await import('./review-bridge.js')
    const result = await runReviewPipeline({
      repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [],
    })
    expect(result.risk_level).toBe('low')
  })

  // Outbound half of review finding B4. The agents service's POST /review is
  // behind the signed internal-token guard with a fail-closed 503
  // (arete_agents/internal_auth.py); this process is one of its callers and
  // must actually put a valid signed credential on the wire, or every review
  // 401s.
  it('sends the internal bearer token to the agents service', async () => {
    vi.stubEnv('INTERNAL_TOKEN_SIGNING_KEYS', JSON.stringify({ k1: 'a'.repeat(48) }))
    vi.stubEnv('INTERNAL_TOKEN_ACTIVE_KID', 'k1')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_RESULT),
    })
    global.fetch = fetchMock as any

    const { runReviewPipeline } = await import('./review-bridge.js')
    await runReviewPipeline({ repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/review'),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: expect.stringMatching(/^Bearer .+/) }),
      })
    )
    const { verifyInternalToken } = await import('@arete/internal-token')
    const sentAuth = (fetchMock.mock.calls[0][1] as any).headers.authorization as string
    await expect(verifyInternalToken(sentAuth)).resolves.toMatchObject({ ok: true, iss: 'arete-webhook' })
    vi.unstubAllEnvs()
  })

  it('throws when Python process exits non-zero', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Error')
    }) as any

    const { runReviewPipeline } = await import('./review-bridge.js')
    await expect(
      runReviewPipeline({ repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] })
    ).rejects.toThrow('exited with status 500')
  })

  it('resolves the tenant llm block and forwards it on the /review payload when an installationId is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_RESULT),
    })
    global.fetch = fetchMock as any

    const resolveModel = vi.fn().mockResolvedValue({
      provider: 'anthropic', model: 'claude-opus-4', apiKey: 'sk-DECRYPTED',
    })

    const { runReviewPipeline } = await import('./review-bridge.js')
    await runReviewPipeline(
      { repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [], installationId: 987654 },
      { resolveModel },
    )

    expect(resolveModel).toHaveBeenCalledWith(987654)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body as string)
    expect(body.llm).toEqual({ provider: 'anthropic', model: 'claude-opus-4', apiKey: 'sk-DECRYPTED' })
  })

  it('omits the llm block entirely when the tenant has no connection (agents uses its own default)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(MOCK_RESULT) })
    global.fetch = fetchMock as any
    const resolveModel = vi.fn().mockResolvedValue(undefined)

    const { runReviewPipeline } = await import('./review-bridge.js')
    await runReviewPipeline(
      { repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [], installationId: 987654 },
      { resolveModel },
    )

    expect(resolveModel).toHaveBeenCalledWith(987654)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body as string)
    expect(body.llm).toBeUndefined()
  })

  it('does not resolve an llm block when no installationId is present (thin-bridge unit path)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(MOCK_RESULT) })
    global.fetch = fetchMock as any
    const resolveModel = vi.fn()

    const { runReviewPipeline } = await import('./review-bridge.js')
    await runReviewPipeline({ repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] }, { resolveModel })

    expect(resolveModel).not.toHaveBeenCalled()
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body as string)
    expect(body.llm).toBeUndefined()
  })

  it('rejects with timeout error when process takes too long', async () => {
    // Pin the (now configurable) timeout so the test is independent of the
    // generous 15-min default — the default exists for slow local models.
    const prevTimeout = process.env.REVIEW_REQUEST_TIMEOUT_MS
    process.env.REVIEW_REQUEST_TIMEOUT_MS = '120000'
    vi.useFakeTimers()
    global.fetch = vi.fn((url, options) => new Promise((resolve, reject) => {
      if (options && (options as any).signal) {
        (options as any).signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }
    })) as any

    const { runReviewPipeline } = await import('./review-bridge.js')
    const promise = runReviewPipeline({ repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] })
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
    if (prevTimeout === undefined) delete process.env.REVIEW_REQUEST_TIMEOUT_MS
    else process.env.REVIEW_REQUEST_TIMEOUT_MS = prevTimeout
  })

})
