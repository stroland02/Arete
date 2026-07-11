import type { Octokit } from '@octokit/core'
import type { ScmProvider } from '@arete/db'
import type { TelemetryConnectorConfig, TelemetrySnapshot } from '../types.js'
import type { ConnectorResult } from './connector-result.js'
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
  cacheScope: string,
  installationId: string | null,
  owner: string,
  repo: string,
  connector: TelemetryConnectorConfig
): Promise<TelemetrySnapshot | null> {
  const sourceRef = sourceRefFor(owner, repo, connector)

  if (isTelemetryCircuitOpen(connector.provider)) return null

  const cached = getCachedTelemetry(cacheScope, connector.provider, sourceRef)
  if (cached) return cached

  let result: ConnectorResult = { status: 'no-data' }

  try {
    if (connector.provider === 'github_actions') {
      result = await fetchGitHubActionsSnapshot(octokit, owner, repo)
    } else if (connector.provider === 'posthog') {
      // No Installation row (repo has never persisted a review) or no
      // TelemetryConnection row (customer never connected PostHog) is a
      // configuration gap, not a provider failure — skip without touching
      // the circuit breaker.
      if (!installationId) return null
      const connection = await prisma.telemetryConnection.findUnique({
        where: { installationId_provider: { installationId, provider: 'posthog' } },
      })
      if (!connection) return null
      const credentials = decryptCredentials<PostHogCredentials>(connection.credentials)
      result = await fetchPostHogSnapshot(credentials, sourceRef)
    }
  } catch {
    result = { status: 'error' }
  }

  if (result.status === 'ok') {
    recordTelemetrySuccess(connector.provider)
    setCachedTelemetry(cacheScope, connector.provider, sourceRef, result.snapshot)
    return result.snapshot
  }

  if (result.status === 'error') {
    // Provider name only — never the raw error, which could carry
    // credential-adjacent details (URLs, headers) from the connectors.
    console.warn(`[telemetry] ${connector.provider} connector failed for ${sourceRef}; review proceeds without it`)
    recordTelemetryFailure(connector.provider)
    return null
  }

  // 'no-data': the provider answered, it just had nothing to report (e.g. a
  // repo with no CI runs). The provider IS healthy — record a success so a
  // legitimately empty result can never open the circuit breaker.
  recordTelemetrySuccess(connector.provider)
  return null
}

/**
 * Fetches production/business telemetry for every connector configured in
 * a repo's .arete.yml, deduplicated to unique (provider, source_ref) pairs.
 * Runs entirely on the Node side — the Python agents service never sees a
 * credential, only the normalized TelemetrySnapshot results (see PRContext.
 * telemetry). Any single connector's failure never affects another
 * connector or blocks the review — this always resolves, never rejects.
 *
 * Takes the SCM provider + the provider's numeric external installation id
 * (what webhook job data carries), NOT the internal Installation UUID:
 * TelemetryConnection.installationId FK-references Installation.id, so the
 * UUID is resolved here via @@unique([provider, externalId]) — the same
 * resolution persistReview does in persistence.ts.
 */
export async function fetchTelemetryContext(
  octokit: Octokit,
  provider: ScmProvider,
  installationExternalId: number,
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

  // Resolve the internal Installation UUID once, and only when a connector
  // actually needs a stored credential (github_actions reuses the job's
  // Octokit client and never touches the DB). A DB error here must not
  // block the review — the credentialed connectors are just skipped.
  let installationId: string | null = null
  if (deduped.some((c) => c.provider !== 'github_actions')) {
    try {
      const installation = await prisma.installation.findUnique({
        where: { provider_externalId: { provider, externalId: installationExternalId } },
      })
      installationId = installation?.id ?? null
    } catch {
      installationId = null
    }
  }

  // Cache scope key: provider-qualified external id — stable for an
  // installation whether or not its Installation row exists yet.
  const cacheScope = `${provider}:${installationExternalId}`

  const results = await Promise.all(
    deduped.map((c) => fetchOneConnector(octokit, cacheScope, installationId, owner, repo, c))
  )

  return results.filter((s): s is TelemetrySnapshot => s !== null)
}
