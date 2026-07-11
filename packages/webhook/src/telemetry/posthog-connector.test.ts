import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPostHogSnapshot } from './posthog-connector.js'

describe('fetchPostHogSnapshot', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('summarizes a successful PostHog query response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [['checkout_completed', 420], ['checkout_started', 1200]],
      }),
    }) as any

    const snap = await fetchPostHogSnapshot({ apiKey: 'phc_test' }, 'production-app')
    expect(snap).not.toBeNull()
    expect(snap!.provider).toBe('posthog')
    expect(snap!.source_ref).toBe('production-app')
    expect(snap!.summary_text.length).toBeGreaterThan(0)
  })

  it('returns null (never throws) on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }) as any
    const snap = await fetchPostHogSnapshot({ apiKey: 'bad-key' }, 'production-app')
    expect(snap).toBeNull()
  })

  it('returns null (never throws) when the request times out', async () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10)
      })
    ) as any
    const snap = await fetchPostHogSnapshot({ apiKey: 'phc_test' }, 'production-app')
    expect(snap).toBeNull()
  })

  it('never sends the API key to a non-allowlisted host', async () => {
    // Sanity check that the connector uses the fixed PostHog host, not
    // anything derived from caller input — there is no host parameter on
    // fetchPostHogSnapshot at all, which is the actual guarantee; this test
    // documents that contract.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }) as any
    await fetchPostHogSnapshot({ apiKey: 'phc_test' }, 'production-app')
    const calledUrl = (global.fetch as any).mock.calls[0][0] as string
    expect(new URL(calledUrl).hostname).toBe('app.posthog.com')
  })
})
