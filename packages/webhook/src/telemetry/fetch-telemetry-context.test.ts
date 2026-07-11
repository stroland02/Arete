import { describe, it, expect, vi, beforeEach } from 'vitest'

const GH_SNAPSHOT = {
  provider: 'github_actions', source_ref: 'acme/api', summary_text: 'ok',
  metrics: {}, links: [], fetched_at: '2026-07-10T00:00:00Z',
}
const PH_SNAPSHOT = {
  provider: 'posthog', source_ref: 'production-app', summary_text: 'ok',
  metrics: {}, links: [], fetched_at: '2026-07-10T00:00:00Z',
}

describe('fetchTelemetryContext', () => {
  beforeEach(() => vi.resetModules())

  it('returns snapshots for every configured connector', async () => {
    vi.doMock('./github-actions-connector.js', () => ({ fetchGitHubActionsSnapshot: vi.fn().mockResolvedValue(GH_SNAPSHOT) }))
    vi.doMock('./posthog-connector.js', () => ({ fetchPostHogSnapshot: vi.fn().mockResolvedValue(PH_SNAPSHOT) }))
    vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ apiKey: 'phc_test' }) }))
    vi.doMock('../db.js', () => ({
      prisma: {
        telemetryConnection: {
          findUnique: vi.fn().mockResolvedValue({ credentials: 'encrypted', config: { project: 'production-app' } }),
        },
      },
    }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const octokit = {} as any
    const result = await fetchTelemetryContext(octokit, 'inst-1', 'acme', 'api', [
      { provider: 'github_actions' },
      { provider: 'posthog', project: 'production-app' },
    ])

    expect(result).toHaveLength(2)
    expect(result.map((s) => s.provider).sort()).toEqual(['github_actions', 'posthog'])
  })

  it('returns an empty array when no connectors are configured', async () => {
    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'inst-1', 'acme', 'api', [])
    expect(result).toEqual([])
  })

  it('skips a connector whose credentials are not configured, without throwing', async () => {
    vi.doMock('../db.js', () => ({
      prisma: { telemetryConnection: { findUnique: vi.fn().mockResolvedValue(null) } },
    }))
    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'inst-1', 'acme', 'api', [
      { provider: 'posthog', project: 'production-app' },
    ])
    expect(result).toEqual([])
  })

  it('one connector failing does not prevent another from succeeding', async () => {
    vi.doMock('./github-actions-connector.js', () => ({ fetchGitHubActionsSnapshot: vi.fn().mockResolvedValue(null) }))
    vi.doMock('./posthog-connector.js', () => ({ fetchPostHogSnapshot: vi.fn().mockResolvedValue(PH_SNAPSHOT) }))
    vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ apiKey: 'phc_test' }) }))
    vi.doMock('../db.js', () => ({
      prisma: {
        telemetryConnection: {
          findUnique: vi.fn().mockResolvedValue({ credentials: 'encrypted', config: { project: 'production-app' } }),
        },
      },
    }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'inst-1', 'acme', 'api', [
      { provider: 'github_actions' },
      { provider: 'posthog', project: 'production-app' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('posthog')
  })

  it('deduplicates two connectors that resolve to the same provider+source_ref', async () => {
    const ghFetch = vi.fn().mockResolvedValue(GH_SNAPSHOT)
    vi.doMock('./github-actions-connector.js', () => ({ fetchGitHubActionsSnapshot: ghFetch }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    // Same provider config declared twice — should still only fetch once.
    await fetchTelemetryContext({} as any, 'inst-1', 'acme', 'api', [
      { provider: 'github_actions' },
      { provider: 'github_actions' },
    ])
    expect(ghFetch).toHaveBeenCalledTimes(1)
  })
})
