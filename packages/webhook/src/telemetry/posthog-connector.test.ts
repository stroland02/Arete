import { webhookFetch } from '@arete/net-guard'
vi.mock('@arete/net-guard', () => ({ webhookFetch: vi.fn() }))
const webhookFetchMock = vi.mocked(webhookFetch)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPostHogSnapshot } from './posthog-connector.js'

describe('fetchPostHogSnapshot', () => {
  

  afterEach(() => {
    webhookFetchMock.mockReset()
  })

  it('summarizes a successful PostHog query response', async () => {
    webhookFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [['checkout_completed', 420], ['checkout_started', 1200]],
      }),
    }) as any

    const result = await fetchPostHogSnapshot({ apiKey: 'phc_test' }, 'production-app')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.snapshot.provider).toBe('posthog')
    expect(result.snapshot.source_ref).toBe('production-app')
    expect(result.snapshot.summary_text.length).toBeGreaterThan(0)
  })

  it('returns no-data (not an error) when the project has no events in the window', async () => {
    webhookFetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }) as any
    const result = await fetchPostHogSnapshot({ apiKey: 'phc_test' }, 'production-app')
    expect(result).toEqual({ status: 'no-data' })
  })

  it('returns an error result (never throws) on a non-OK response', async () => {
    webhookFetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }) as any
    const result = await fetchPostHogSnapshot({ apiKey: 'bad-key' }, 'production-app')
    expect(result).toEqual({ status: 'error' })
  })

  it('returns an error result (never throws) when the request times out', async () => {
    webhookFetchMock.mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10)
      })
    ) as any
    const result = await fetchPostHogSnapshot({ apiKey: 'phc_test' }, 'production-app')
    expect(result).toEqual({ status: 'error' })
  })

  it('never sends the API key to a non-allowlisted host', async () => {
    // Sanity check that the connector uses the fixed PostHog host, not
    // anything derived from caller input — there is no host parameter on
    // fetchPostHogSnapshot at all, which is the actual guarantee; this test
    // documents that contract.
    webhookFetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }) as any
    await fetchPostHogSnapshot({ apiKey: 'phc_test' }, 'production-app')
    const calledUrl = webhookFetchMock.mock.calls[0][0] as string
    expect(new URL(calledUrl).hostname).toBe('app.posthog.com')
  })
})

