import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchSentrySnapshot } from './sentry-connector.js'

describe('fetchSentrySnapshot', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('summarizes recent Sentry issues', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { title: 'TypeError: x is undefined', count: '42', shortId: 'ACME-1', permalink: 'https://acme.sentry.io/issues/1' },
        { title: 'NullPointerException', count: '7', shortId: 'ACME-2', permalink: 'https://acme.sentry.io/issues/2' },
      ]),
    }) as any

    const result = await fetchSentrySnapshot({ token: 'tok' }, 'acme', 'backend')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.snapshot.provider).toBe('sentry')
      expect(result.snapshot.source_ref).toBe('acme/backend')
      expect(result.snapshot.summary_text).toContain('TypeError')
      expect(result.snapshot.links).toContain('https://acme.sentry.io/issues/1')
    }
  })

  it('returns no-data when there are zero issues', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ([]) }) as any
    const result = await fetchSentrySnapshot({ token: 'tok' }, 'acme', 'backend')
    expect(result.status).toBe('no-data')
  })

  it('returns error (never throws) on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any
    const result = await fetchSentrySnapshot({ token: 'bad' }, 'acme', 'backend')
    expect(result.status).toBe('error')
  })

  it('returns error (never throws) when the request times out', async () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10)
      })
    ) as any
    const result = await fetchSentrySnapshot({ token: 'tok' }, 'acme', 'backend')
    expect(result.status).toBe('error')
  })

  it('queries the org-level issues endpoint with a 7-day statsPeriod and project filter', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ([]) }) as any
    await fetchSentrySnapshot({ token: 'tok' }, 'acme', 'backend')
    const calledUrl = new URL((global.fetch as any).mock.calls[0][0] as string)
    expect(calledUrl.hostname).toBe('sentry.io')
    expect(calledUrl.pathname).toBe('/api/0/organizations/acme/issues/')
    expect(calledUrl.searchParams.get('statsPeriod')).toBe('7d')
    expect(calledUrl.searchParams.get('project')).toBe('backend')
  })
})
