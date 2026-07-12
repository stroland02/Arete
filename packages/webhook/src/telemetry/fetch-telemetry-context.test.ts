import { describe, it, expect, vi, beforeEach } from 'vitest'

const GH_SNAPSHOT = {
  provider: 'github_actions', source_ref: 'acme/api', summary_text: 'ok',
  metrics: {}, links: [], fetched_at: '2026-07-10T00:00:00Z',
}
const PH_SNAPSHOT = {
  provider: 'posthog', source_ref: 'production-app', summary_text: 'ok',
  metrics: {}, links: [], fetched_at: '2026-07-10T00:00:00Z',
}

// The internal Installation primary key is a UUID; the GitHub App
// installation id (42 below) is a provider-scoped external id. The two must
// never be conflated — TelemetryConnection.installationId FK-references the
// UUID.
const INSTALLATION_UUID = '7f9c1c2e-5b7a-4a5d-9e3f-2d8b6c4a1e0f'
const GITHUB_INSTALLATION_ID = 42

/** Prisma mock shaped like the real schema: Installation is looked up by
 * @@unique([provider, externalId]); TelemetryConnection only matches when
 * queried with the Installation UUID, exactly like the real FK-backed row. */
function makeRealisticPrisma() {
  return {
    installation: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = where?.provider_externalId
        if (key && key.provider === 'github' && key.externalId === GITHUB_INSTALLATION_ID) {
          return { id: INSTALLATION_UUID, provider: 'github', externalId: GITHUB_INSTALLATION_ID }
        }
        return null
      }),
    },
    telemetryConnection: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = where?.installationId_provider
        if (key && key.installationId === INSTALLATION_UUID && key.provider === 'posthog') {
          return {
            id: 'conn-1',
            installationId: INSTALLATION_UUID,
            provider: 'posthog',
            credentials: 'encrypted',
            config: { project: 'production-app' },
          }
        }
        return null
      }),
    },
  }
}

describe('fetchTelemetryContext', () => {
  beforeEach(() => vi.resetModules())

  it('returns snapshots for every configured connector', async () => {
    vi.doMock('./github-actions-connector.js', () => ({
      fetchGitHubActionsSnapshot: vi.fn().mockResolvedValue({ status: 'ok', snapshot: GH_SNAPSHOT }),
    }))
    vi.doMock('./posthog-connector.js', () => ({
      fetchPostHogSnapshot: vi.fn().mockResolvedValue({ status: 'ok', snapshot: PH_SNAPSHOT }),
    }))
    vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ apiKey: 'phc_test' }) }))
    vi.doMock('../db.js', () => ({ prisma: makeRealisticPrisma() }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const octokit = {} as any
    const result = await fetchTelemetryContext(octokit, 'github', GITHUB_INSTALLATION_ID, 'acme', 'api', [
      { provider: 'github_actions' },
      { provider: 'posthog', project: 'production-app' },
    ])

    expect(result).toHaveLength(2)
    expect(result.map((s) => s.provider).sort()).toEqual(['github_actions', 'posthog'])
  })

  it('resolves the internal Installation UUID before querying TelemetryConnection (never queries with the GitHub installation id)', async () => {
    const prisma = makeRealisticPrisma()
    vi.doMock('../db.js', () => ({ prisma }))
    vi.doMock('./posthog-connector.js', () => ({
      fetchPostHogSnapshot: vi.fn().mockResolvedValue({ status: 'ok', snapshot: PH_SNAPSHOT }),
    }))
    vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ apiKey: 'phc_test' }) }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'github', GITHUB_INSTALLATION_ID, 'acme', 'api', [
      { provider: 'posthog', project: 'production-app' },
    ])

    // The credential lookup succeeds — impossible unless the numeric GitHub
    // installation id was first resolved to the Installation UUID, because
    // the realistic mock (like the real FK-backed column) only matches the
    // UUID.
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('posthog')
    expect(prisma.installation.findUnique).toHaveBeenCalledWith({
      where: { provider_externalId: { provider: 'github', externalId: GITHUB_INSTALLATION_ID } },
    })
    expect(prisma.telemetryConnection.findUnique).toHaveBeenCalledWith({
      where: { installationId_provider: { installationId: INSTALLATION_UUID, provider: 'posthog' } },
    })
  })

  it('skips posthog without throwing when no Installation row exists yet', async () => {
    const prisma = makeRealisticPrisma()
    prisma.installation.findUnique.mockResolvedValue(null)
    vi.doMock('../db.js', () => ({ prisma }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'github', GITHUB_INSTALLATION_ID, 'acme', 'api', [
      { provider: 'posthog', project: 'production-app' },
    ])
    expect(result).toEqual([])
    expect(prisma.telemetryConnection.findUnique).not.toHaveBeenCalled()
  })

  it('returns an empty array when no connectors are configured', async () => {
    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'github', GITHUB_INSTALLATION_ID, 'acme', 'api', [])
    expect(result).toEqual([])
  })

  it('skips a connector whose credentials are not configured, without throwing', async () => {
    const prisma = makeRealisticPrisma()
    prisma.telemetryConnection.findUnique.mockResolvedValue(null)
    vi.doMock('../db.js', () => ({ prisma }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'github', GITHUB_INSTALLATION_ID, 'acme', 'api', [
      { provider: 'posthog', project: 'production-app' },
    ])
    expect(result).toEqual([])
  })

  it('one connector failing does not prevent another from succeeding', async () => {
    vi.doMock('./github-actions-connector.js', () => ({
      fetchGitHubActionsSnapshot: vi.fn().mockResolvedValue({ status: 'error' }),
    }))
    vi.doMock('./posthog-connector.js', () => ({
      fetchPostHogSnapshot: vi.fn().mockResolvedValue({ status: 'ok', snapshot: PH_SNAPSHOT }),
    }))
    vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ apiKey: 'phc_test' }) }))
    vi.doMock('../db.js', () => ({ prisma: makeRealisticPrisma() }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'github', GITHUB_INSTALLATION_ID, 'acme', 'api', [
      { provider: 'github_actions' },
      { provider: 'posthog', project: 'production-app' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('posthog')
  })

  it('deduplicates two connectors that resolve to the same provider+source_ref', async () => {
    const ghFetch = vi.fn().mockResolvedValue({ status: 'ok', snapshot: GH_SNAPSHOT })
    vi.doMock('./github-actions-connector.js', () => ({ fetchGitHubActionsSnapshot: ghFetch }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    // Same provider config declared twice — should still only fetch once.
    await fetchTelemetryContext({} as any, 'github', GITHUB_INSTALLATION_ID, 'acme', 'api', [
      { provider: 'github_actions' },
      { provider: 'github_actions' },
    ])
    expect(ghFetch).toHaveBeenCalledTimes(1)
  })

  it('does not open the circuit breaker on consecutive legitimate no-data results', async () => {
    const ghFetch = vi.fn().mockResolvedValue({ status: 'no-data' })
    vi.doMock('./github-actions-connector.js', () => ({ fetchGitHubActionsSnapshot: ghFetch }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    // 7 consecutive reviews of a repo with no CI configured — well past the
    // breaker's failure threshold of 5.
    for (let i = 0; i < 7; i++) {
      const result = await fetchTelemetryContext({} as any, 'github', GITHUB_INSTALLATION_ID, 'acme', 'api', [
        { provider: 'github_actions' },
      ])
      expect(result).toEqual([])
    }
    // If no-data counted as a breaker failure, the circuit would have opened
    // after call 5 and short-circuited calls 6 and 7 before reaching the
    // connector.
    expect(ghFetch).toHaveBeenCalledTimes(7)
  })

  it('dispatches to the Sentry connector for a sentry connector config', async () => {
    vi.doMock('./sentry-connector.js', () => ({
      fetchSentrySnapshot: vi.fn().mockResolvedValue({
        status: 'ok',
        snapshot: { provider: 'sentry', source_ref: 'acme/backend', summary_text: 'ok', metrics: {}, links: [], fetched_at: '2026-07-11T00:00:00Z' },
      }),
    }))
    vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ token: 'tok' }) }))
    vi.doMock('../db.js', () => ({
      prisma: {
        installation: { findUnique: vi.fn().mockResolvedValue({ id: 'inst-uuid-1' }) },
        telemetryConnection: {
          findUnique: vi.fn().mockResolvedValue({ credentials: 'encrypted', config: { org: 'acme', project: 'backend' } }),
        },
      },
    }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'github', 42, 'acme', 'backend', [
      { provider: 'sentry', org: 'acme', project: 'backend' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('sentry')
  })

  it('dispatches to the Vercel connector for a vercel connector config', async () => {
    vi.doMock('./vercel-connector.js', () => ({
      fetchVercelSnapshot: vi.fn().mockResolvedValue({
        status: 'ok',
        snapshot: { provider: 'vercel', source_ref: 'prj_123', summary_text: 'ok', metrics: {}, links: [], fetched_at: '2026-07-11T00:00:00Z' },
      }),
    }))
    vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ token: 'tok' }) }))
    vi.doMock('../db.js', () => ({
      prisma: {
        installation: { findUnique: vi.fn().mockResolvedValue({ id: 'inst-uuid-1' }) },
        telemetryConnection: {
          findUnique: vi.fn().mockResolvedValue({ credentials: 'encrypted', config: { project: 'prj_123' } }),
        },
      },
    }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'github', 42, 'acme', 'backend', [
      { provider: 'vercel', project: 'prj_123' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('vercel')
  })

  it('dispatches to the Stripe connector for a stripe connector config', async () => {
    vi.doMock('./stripe-telemetry-connector.js', () => ({
      fetchStripeSnapshot: vi.fn().mockResolvedValue({
        status: 'ok',
        snapshot: { provider: 'stripe', source_ref: 'account', summary_text: 'ok', metrics: {}, links: [], fetched_at: '2026-07-11T00:00:00Z' },
      }),
    }))
    vi.doMock('./credentials.js', () => ({ decryptCredentials: vi.fn().mockReturnValue({ secretKey: 'rk_test' }) }))
    vi.doMock('../db.js', () => ({
      prisma: {
        installation: { findUnique: vi.fn().mockResolvedValue({ id: 'inst-uuid-1' }) },
        telemetryConnection: {
          findUnique: vi.fn().mockResolvedValue({ credentials: 'encrypted', config: {} }),
        },
      },
    }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    const result = await fetchTelemetryContext({} as any, 'github', 42, 'acme', 'backend', [
      { provider: 'stripe' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('stripe')
  })

  it('still opens the circuit breaker after consecutive real provider errors', async () => {
    const ghFetch = vi.fn().mockResolvedValue({ status: 'error' })
    vi.doMock('./github-actions-connector.js', () => ({ fetchGitHubActionsSnapshot: ghFetch }))

    const { fetchTelemetryContext } = await import('./fetch-telemetry-context.js')
    for (let i = 0; i < 7; i++) {
      const result = await fetchTelemetryContext({} as any, 'github', GITHUB_INSTALLATION_ID, 'acme', 'api', [
        { provider: 'github_actions' },
      ])
      expect(result).toEqual([])
    }
    // Breaker threshold is 5 consecutive failures — calls 6 and 7 must be
    // short-circuited without hitting the connector.
    expect(ghFetch).toHaveBeenCalledTimes(5)
  })
})
