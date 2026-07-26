import { webhookFetch } from '@arete/net-guard'
vi.mock('@arete/net-guard', () => ({ webhookFetch: vi.fn() }))
const webhookFetchMock = vi.mocked(webhookFetch)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchVercelSnapshot } from './vercel-connector.js'

describe('fetchVercelSnapshot', () => {
  
  afterEach(() => { webhookFetchMock.mockReset() })

  it('summarizes recent deployment health', async () => {
    webhookFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        deployments: [
          { uid: 'd1', readyState: 'READY', createdAt: 1720000000000, url: 'app-1.vercel.app' },
          { uid: 'd2', readyState: 'READY', createdAt: 1720000001000, url: 'app-2.vercel.app' },
          { uid: 'd3', readyState: 'ERROR', createdAt: 1720000002000, url: 'app-3.vercel.app' },
        ],
      }),
    } as unknown as Response)

    const result = await fetchVercelSnapshot({ token: 'tok' }, 'prj_123')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.snapshot.provider).toBe('vercel')
      expect(result.snapshot.source_ref).toBe('prj_123')
      expect(result.snapshot.summary_text).toContain('2')
      expect(result.snapshot.summary_text).toContain('3')
      expect(result.snapshot.metrics.failure_rate).toBeCloseTo(1 / 3)
    }
  })

  it('returns no-data when there are zero deployments', async () => {
    webhookFetchMock.mockResolvedValue({ ok: true, json: async () => ({ deployments: [] }) } as unknown as Response)
    const result = await fetchVercelSnapshot({ token: 'tok' }, 'prj_123')
    expect(result.status).toBe('no-data')
  })

  it('returns error (never throws) on a non-OK response', async () => {
    webhookFetchMock.mockResolvedValue({ ok: false, status: 403 } as unknown as Response)
    const result = await fetchVercelSnapshot({ token: 'bad' }, 'prj_123')
    expect(result.status).toBe('error')
  })

  it('returns error (never throws) when the request times out', async () => {
    webhookFetchMock.mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10)
      })
    ) as any
    const result = await fetchVercelSnapshot({ token: 'tok' }, 'prj_123')
    expect(result.status).toBe('error')
  })

  it('includes teamId in the query only when provided', async () => {
    webhookFetchMock.mockResolvedValue({ ok: true, json: async () => ({ deployments: [] }) } as unknown as Response)
    await fetchVercelSnapshot({ token: 'tok' }, 'prj_123', 'team_abc')
    const calledUrl = new URL(webhookFetchMock.mock.calls[0][0] as string)
    expect(calledUrl.hostname).toBe('api.vercel.com')
    expect(calledUrl.pathname).toBe('/v6/deployments')
    expect(calledUrl.searchParams.get('projectId')).toBe('prj_123')
    expect(calledUrl.searchParams.get('teamId')).toBe('team_abc')
  })

  it('omits teamId from the query when not provided', async () => {
    webhookFetchMock.mockResolvedValue({ ok: true, json: async () => ({ deployments: [] }) } as unknown as Response)
    await fetchVercelSnapshot({ token: 'tok' }, 'prj_123')
    const calledUrl = new URL(webhookFetchMock.mock.calls[0][0] as string)
    expect(calledUrl.searchParams.has('teamId')).toBe(false)
  })
})

