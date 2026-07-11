import type { ConnectorResult } from './connector-result.js'
import { assertAllowedTelemetryHost } from './ssrf-guard.js'

const POSTHOG_QUERY_URL = 'https://app.posthog.com/api/query'
const FETCH_TIMEOUT_MS = 8_000

export interface PostHogCredentials {
  apiKey: string
}

/**
 * Queries PostHog for recent event volume for the configured project.
 * Never throws — a project with no events in the window resolves to
 * 'no-data', and any real failure (auth error, timeout, network error)
 * resolves to 'error'. Only 'error' counts against the provider circuit
 * breaker in fetch-telemetry-context.ts.
 */
export async function fetchPostHogSnapshot(
  credentials: PostHogCredentials,
  projectId: string
): Promise<ConnectorResult> {
  assertAllowedTelemetryHost('posthog', POSTHOG_QUERY_URL)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(POSTHOG_QUERY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: `SELECT event, count() FROM events WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY event ORDER BY count() DESC LIMIT 5`,
        },
      }),
      signal: controller.signal,
    })

    if (!res.ok) return { status: 'error' }

    const data = (await res.json()) as { results?: Array<[string, number]> }
    const results = data.results ?? []
    if (results.length === 0) return { status: 'no-data' }

    const summary = results.map(([event, count]) => `${event}: ${count}`).join(', ')
    const metrics: Record<string, number> = {}
    for (const [event, count] of results) metrics[event] = count

    return {
      status: 'ok',
      snapshot: {
        provider: 'posthog',
        source_ref: projectId,
        summary_text: `Top events over the last 7 days — ${summary}.`,
        metrics,
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
