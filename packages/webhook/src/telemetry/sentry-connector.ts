import type { ConnectorResult } from './connector-result.js'
import { assertAllowedTelemetryHost } from './ssrf-guard.js'

const SENTRY_BASE_URL = 'https://sentry.io/api/0'
const FETCH_TIMEOUT_MS = 8_000
const MAX_ISSUES_IN_SUMMARY = 5

export interface SentryCredentials {
  token: string
}

interface SentryIssue {
  title: string
  count: string
  shortId: string
  permalink: string
}

/**
 * Fetches recent unresolved issues for a Sentry project over the last 7
 * days. Never throws — a project with zero recent issues resolves to
 * 'no-data', any real failure (auth error, timeout, network error)
 * resolves to 'error'. Matches the posthog-connector.ts contract exactly.
 */
export async function fetchSentrySnapshot(
  credentials: SentryCredentials,
  org: string,
  project: string
): Promise<ConnectorResult> {
  const url = new URL(`${SENTRY_BASE_URL}/organizations/${org}/issues/`)
  url.searchParams.set('statsPeriod', '7d')
  url.searchParams.set('project', project)

  assertAllowedTelemetryHost('sentry', url.toString())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${credentials.token}` },
      signal: controller.signal,
    })

    if (!res.ok) return { status: 'error' }

    const issues = (await res.json()) as SentryIssue[]
    if (issues.length === 0) return { status: 'no-data' }

    const top = issues.slice(0, MAX_ISSUES_IN_SUMMARY)
    const summary = top.map((i) => `${i.title} (${i.count}x)`).join(', ')

    return {
      status: 'ok',
      snapshot: {
        provider: 'sentry',
        source_ref: `${org}/${project}`,
        summary_text: `Recent Sentry issues over the last 7 days — ${summary}.`,
        metrics: { issue_count: issues.length },
        links: top.map((i) => i.permalink).filter(Boolean),
        fetched_at: new Date().toISOString(),
      },
    }
  } catch {
    return { status: 'error' }
  } finally {
    clearTimeout(timer)
  }
}
