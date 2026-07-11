import type { ConnectorResult } from './connector-result.js'
import { assertAllowedTelemetryHost } from './ssrf-guard.js'

const STRIPE_BASE_URL = 'https://api.stripe.com'
const FETCH_TIMEOUT_MS = 8_000
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60

export interface StripeTelemetryCredentials {
  secretKey: string
}

interface StripeCharge {
  amount: number
  status: string
}

/**
 * Fetches successful/failed charge revenue for the last 7 days. Never
 * throws — zero charges resolves to 'no-data', any real failure resolves
 * to 'error'. Matches the posthog-connector.ts contract exactly. Amounts
 * are Stripe's native minor-unit integers (e.g. cents) — not converted to
 * a major currency unit here, since Stripe accounts can use different
 * currencies and the caller/prompt can format as needed.
 */
export async function fetchStripeSnapshot(credentials: StripeTelemetryCredentials): Promise<ConnectorResult> {
  const sinceUnix = Math.floor(Date.now() / 1000) - SEVEN_DAYS_SECONDS
  const url = new URL(`${STRIPE_BASE_URL}/v1/charges`)
  url.searchParams.set('created[gte]', String(sinceUnix))
  url.searchParams.set('limit', '100')

  assertAllowedTelemetryHost('stripe', url.toString())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${credentials.secretKey}` },
      signal: controller.signal,
    })

    if (!res.ok) return { status: 'error' }

    const data = (await res.json()) as { data?: StripeCharge[] }
    const charges = data.data ?? []
    if (charges.length === 0) return { status: 'no-data' }

    const successful = charges.filter((c) => c.status === 'succeeded')
    const failed = charges.filter((c) => c.status !== 'succeeded')
    const revenueCents = successful.reduce((sum, c) => sum + c.amount, 0)

    return {
      status: 'ok',
      snapshot: {
        provider: 'stripe',
        source_ref: 'account',
        summary_text: `${successful.length} successful charges (${revenueCents} minor units) and ${failed.length} failed charges over the last 7 days.`,
        metrics: {
          revenue_cents: revenueCents,
          successful_charge_count: successful.length,
          failed_charge_count: failed.length,
        },
        links: [],
        fetched_at: new Date().toISOString(),
      },
    }
  } catch {
    return { status: 'error' }
  } finally {
    clearTimeout(timer)
  }
}
