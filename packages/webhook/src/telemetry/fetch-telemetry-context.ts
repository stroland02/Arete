import type { Octokit } from '@octokit/core'
import type { TelemetryConnectorConfig, TelemetrySnapshot } from '../types.js'
import { fetchGitHubActionsSnapshot } from './github-actions-connector.js'
import { fetchPostHogSnapshot, type PostHogCredentials } from './posthog-connector.js'
import { decryptCredentials } from './credentials.js'
import { getCachedTelemetry, setCachedTelemetry } from './cache.js'
import { recordTelemetryFailure, recordTelemetrySuccess, isTelemetryCircuitOpen } from './circuit-breaker.js'
import { prisma } from '../db.js'

function sourceRefFor(owner: string, repo: string, connector: TelemetryConnectorConfig): string {
  if (connector.provider === 'github_actions') return `${owner}/${repo}`
  return connector.project ?? connector.service ?? `${owner}/${repo}`
}

async function fetchOneConnector(
  octokit: Octokit,
  installationId: string,
  owner: string,
  repo: string,
  connector: TelemetryConnectorConfig
): Promise<TelemetrySnapshot | null> {
  const sourceRef = sourceRefFor(owner, repo, connector)

  if (isTelemetryCircuitOpen(connector.provider)) return null

  const cached = getCachedTelemetry(installationId, connector.provider, sourceRef)
  if (cached) return cached

  let snapshot: TelemetrySnapshot | null = null

  try {
    if (connector.provider === 'github_actions') {
      snapshot = await fetchGitHubActionsSnapshot(octokit, owner, repo)
    } else if (connector.provider === 'posthog') {
      const connection = await prisma.telemetryConnection.findUnique({
        where: { installationId_provider: { installationId, provider: 'posthog' } },
      })
      if (!connection) return null
      const credentials = decryptCredentials<PostHogCredentials>(connection.credentials)
      snapshot = await fetchPostHogSnapshot(credentials, sourceRef)
    }
  } catch {
    snapshot = null
  }

  if (snapshot) {
    recordTelemetrySuccess(connector.provider)
    setCachedTelemetry(installationId, connector.provider, sourceRef, snapshot)
  } else {
    // Provider name only — never the raw error, which could carry
    // credential-adjacent details (URLs, headers) from the connectors.
    console.warn(`[telemetry] ${connector.provider} connector returned no data for ${sourceRef}; review proceeds without it`)
    recordTelemetryFailure(connector.provider)
  }

  return snapshot
}

/**
 * Fetches production/business telemetry for every connector configured in
 * a repo's .arete.yml, deduplicated to unique (provider, source_ref) pairs.
 * Runs entirely on the Node side — the Python agents service never sees a
 * credential, only the normalized TelemetrySnapshot results (see PRContext.
 * telemetry). Any single connector's failure never affects another
 * connector or blocks the review — this always resolves, never rejects.
 */
export async function fetchTelemetryContext(
  octokit: Octokit,
  installationId: string,
  owner: string,
  repo: string,
  connectors: TelemetryConnectorConfig[]
): Promise<TelemetrySnapshot[]> {
  if (connectors.length === 0) return []

  const seen = new Set<string>()
  const deduped: TelemetryConnectorConfig[] = []
  for (const c of connectors) {
    const key = `${c.provider}:${sourceRefFor(owner, repo, c)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(c)
  }

  const results = await Promise.all(
    deduped.map((c) => fetchOneConnector(octokit, installationId, owner, repo, c))
  )

  return results.filter((s): s is TelemetrySnapshot => s !== null)
}
