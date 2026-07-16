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

  it('forwards the deployment BYO model config as `llm` when configured', async () => {
    process.env.MODEL_PROVIDER = 'ollama'
    process.env.MODEL_NAME = 'qwen2.5-coder'
    process.env.MODEL_BASE_URL = 'http://localhost:11434'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: vi.fn().mockResolvedValue(MOCK_RESULT),
    })
    global.fetch = fetchMock as any
    try {
      const { runReviewPipeline } = await import('./review-bridge.js')
      await runReviewPipeline({ repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.llm).toEqual({
        provider: 'ollama', model: 'qwen2.5-coder', baseUrl: 'http://localhost:11434',
      })
    } finally {
      delete process.env.MODEL_PROVIDER
      delete process.env.MODEL_NAME
      delete process.env.MODEL_BASE_URL
    }
  })

  it('omits `llm` when no model provider is configured', async () => {
    delete process.env.MODEL_PROVIDER
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: vi.fn().mockResolvedValue(MOCK_RESULT),
    })
    global.fetch = fetchMock as any
    const { runReviewPipeline } = await import('./review-bridge.js')
    await runReviewPipeline({ repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.llm).toBeUndefined()
  })
})
