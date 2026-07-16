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

  it('resolves the tenant model connection and includes it in the /review payload when an installationId is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_RESULT),
    })
    global.fetch = fetchMock as any

    const resolveModel = vi.fn().mockResolvedValue({
      provider: 'openai', model: 'gpt-4o', apiKey: 'sk-DECRYPTED', baseUrl: null,
    })

    const { runReviewPipeline } = await import('./review-bridge.js')
    await runReviewPipeline(
      { repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [], installationId: 987654 },
      { resolveModel },
    )

    expect(resolveModel).toHaveBeenCalledWith(987654)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body as string)
    expect(body.modelConnection).toEqual({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-DECRYPTED', baseUrl: null })
  })

  it('does not resolve a model connection when no installationId is present (thin-bridge unit path)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(MOCK_RESULT) })
    global.fetch = fetchMock as any
    const resolveModel = vi.fn()

    const { runReviewPipeline } = await import('./review-bridge.js')
    await runReviewPipeline({ repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] }, { resolveModel })

    expect(resolveModel).not.toHaveBeenCalled()
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body as string)
    expect(body.modelConnection).toBeUndefined()
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
