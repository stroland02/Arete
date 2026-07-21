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
  // now behind the shared internal bearer with a fail-closed 503
  // (arete_agents/internal_auth.py); this process is one of its callers and
  // must actually put the credential on the wire, or every review 401s.
  it('sends the internal bearer token to the agents service', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', 's3cret')
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
        headers: expect.objectContaining({ authorization: 'Bearer s3cret' }),
      })
    )
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
    
    vi.advanceTimersByTime(120_001)
    await expect(promise).rejects.toThrow('timed out')
    vi.useRealTimers()
  })

})
