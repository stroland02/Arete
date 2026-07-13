import type { ConnectorResult } from './connector-result.js'
import { assertAllowedTelemetryHost } from './ssrf-guard.js'

import { webhookFetch } from '@arete/net-guard'

const VERCEL_BASE_URL = 'https://api.vercel.com'
const FETCH_TIMEOUT_MS = 8_000
const RECENT_DEPLOYMENTS_TO_SAMPLE = 20

export interface VercelCredentials {
  token: string
}

interface VercelDeployment {
  uid: string
  readyState: 'READY' | 'ERROR' | 'CANCELED' | 'BUILDING' | 'QUEUED' | 'INITIALIZING' | string
  createdAt: number
}

/**
 * Fetches recent deployment health for a Vercel project. Never throws — a
 * project with zero deployments resolves to 'no-data', any real failure
 * resolves to 'error'. Matches the posthog-connector.ts contract exactly.
 */
export async function fetchVercelSnapshot(
  credentials: VercelCredentials,
  projectId: string,
  teamId?: string
): Promise<ConnectorResult> {
  const url = new URL(`${VERCEL_BASE_URL}/v6/deployments`)
  url.searchParams.set('projectId', projectId)
  url.searchParams.set('limit', String(RECENT_DEPLOYMENTS_TO_SAMPLE))
  if (teamId) url.searchParams.set('teamId', teamId)

  assertAllowedTelemetryHost('vercel', url.toString())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await webhookFetch(url.toString(), {
      headers: { Authorization: `Bearer ${credentials.token}` },
      signal: controller.signal,
    })

    if (!res.ok) return { status: 'error' }

    const data = (await res.json()) as { deployments?: VercelDeployment[] }
    const deployments = data.deployments ?? []
    if (deployments.length === 0) return { status: 'no-data' }

    const failures = deployments.filter((d) => d.readyState === 'ERROR').length
    const total = deployments.length
    const successes = total - failures

    return {
      status: 'ok',
      snapshot: {
        provider: 'vercel',
        source_ref: projectId,
        summary_text: `${successes} of ${total} recent deployments succeeded (${failures} failed).`,
        metrics: { failure_rate: failures / total },
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
