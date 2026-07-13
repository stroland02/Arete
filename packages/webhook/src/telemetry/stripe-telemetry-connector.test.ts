import { webhookFetch } from '@arete/net-guard'
vi.mock('@arete/net-guard', () => ({ webhookFetch: vi.fn() }))
const webhookFetchMock = vi.mocked(webhookFetch)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchStripeSnapshot } from './stripe-telemetry-connector.js'

describe('fetchStripeSnapshot', () => {
  
  afterEach(() => { webhookFetchMock.mockReset() })

  it('summarizes recent successful revenue', async () => {
    webhookFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { amount: 5000, status: 'succeeded', created: 1720000000 },
          { amount: 2500, status: 'succeeded', created: 1720000001 },
          { amount: 1000, status: 'failed', created: 1720000002 },
        ],
        has_more: false,
      }),
    }) as any

    const result = await fetchStripeSnapshot({ secretKey: 'rk_test_x' })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.snapshot.provider).toBe('stripe')
      expect(result.snapshot.metrics.revenue_cents).toBe(7500)
      expect(result.snapshot.metrics.successful_charge_count).toBe(2)
      expect(result.snapshot.metrics.failed_charge_count).toBe(1)
    }
  })

  it('returns no-data when there are zero charges', async () => {
    webhookFetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [], has_more: false }) }) as any
    const result = await fetchStripeSnapshot({ secretKey: 'rk_test_x' })
    expect(result.status).toBe('no-data')
  })

  it('returns error (never throws) on a non-OK response', async () => {
    webhookFetchMock.mockResolvedValue({ ok: false, status: 401 }) as any
    const result = await fetchStripeSnapshot({ secretKey: 'bad' })
    expect(result.status).toBe('error')
  })

  it('returns error (never throws) when the request times out', async () => {
    webhookFetchMock.mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10)
      })
    ) as any
    const result = await fetchStripeSnapshot({ secretKey: 'rk_test_x' })
    expect(result.status).toBe('error')
  })

  it('queries the charges endpoint with a 7-day created[gte] filter using Bearer auth', async () => {
    webhookFetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [], has_more: false }) }) as any
    await fetchStripeSnapshot({ secretKey: 'rk_test_x' })
    const calledUrl = new URL(webhookFetchMock.mock.calls[0][0] as string)
    const calledOptions = webhookFetchMock.mock.calls[0][1]
    expect(calledUrl.hostname).toBe('api.stripe.com')
    expect(calledUrl.pathname).toBe('/v1/charges')
    expect(calledUrl.searchParams.has('created[gte]')).toBe(true)
    expect(calledOptions.headers.Authorization).toBe('Bearer rk_test_x')
  })
})

