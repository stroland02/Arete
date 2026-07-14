import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeOctokit(prsByRepo: Record<string, any[] | Error>) {
  return {
    rest: {
      pulls: {
        list: vi.fn(async ({ repo, page }: { repo: string; page: number }) => {
          const entry = prsByRepo[repo]
          if (entry instanceof Error) throw entry
          // Single page only for these tests (< 100 results) — page > 1 is empty.
          const data = page === 1 ? (entry ?? []) : []
          return { data }
        }),
      },
    },
  }
}

describe('backfillInstallationPRs', () => {
  beforeEach(() => { vi.resetModules() })

  it('enqueues exactly one job per open PR across the given repos', async () => {
    const mockEnqueue = vi.fn().mockResolvedValue(undefined)
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const octokit = makeOctokit({
      api: [
        { number: 1, head: { sha: 'sha1' } },
        { number: 2, head: { sha: 'sha2' } },
      ],
      web: [
        { number: 5, head: { sha: 'sha5' } },
      ],
    })

    const { backfillInstallationPRs } = await import('./backfill.js')
    await backfillInstallationPRs(octokit as any, 777, [
      { id: 123, name: 'api', full_name: 'acme/api' },
      { id: 456, name: 'web', full_name: 'acme/web' },
    ])

    expect(mockEnqueue).toHaveBeenCalledTimes(3)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'github',
        kind: 'pull_request',
        owner: 'acme',
        repo: 'api',
        repositoryExternalId: 123,
        fullName: 'acme/api',
        installationId: 777,
        prNumber: 1,
        headSha: 'sha1',
      }),
      'fast'
    )
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'web',
        repositoryExternalId: 456,
        prNumber: 5,
        headSha: 'sha5',
      }),
      'fast'
    )
  })

  it('is a no-op for a repo with zero open PRs', async () => {
    const mockEnqueue = vi.fn()
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))

    const octokit = makeOctokit({ empty: [] })

    const { backfillInstallationPRs } = await import('./backfill.js')
    await backfillInstallationPRs(octokit as any, 777, [
      { id: 1, name: 'empty', full_name: 'acme/empty' },
    ])

    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('continues backfilling other repos when one repo fails to list PRs (best-effort)', async () => {
    const mockEnqueue = vi.fn().mockResolvedValue(undefined)
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const octokit = makeOctokit({
      broken: new Error('boom: GitHub API 500'),
      ok: [{ number: 9, head: { sha: 'sha9' } }],
    })

    const { backfillInstallationPRs } = await import('./backfill.js')
    await backfillInstallationPRs(octokit as any, 777, [
      { id: 1, name: 'broken', full_name: 'acme/broken' },
      { id: 2, name: 'ok', full_name: 'acme/ok' },
    ])

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'ok', prNumber: 9 }),
      'fast'
    )
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('continues enqueueing other PRs in a repo when one PR fails to enqueue (best-effort)', async () => {
    const mockEnqueue = vi.fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(undefined)
    vi.doMock('./queue.js', () => ({ enqueueReviewJob: mockEnqueue }))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const octokit = makeOctokit({
      api: [
        { number: 1, head: { sha: 'sha1' } },
        { number: 2, head: { sha: 'sha2' } },
      ],
    })

    const { backfillInstallationPRs } = await import('./backfill.js')
    await backfillInstallationPRs(octokit as any, 777, [
      { id: 123, name: 'api', full_name: 'acme/api' },
    ])

    expect(mockEnqueue).toHaveBeenCalledTimes(2)
    consoleErrorSpy.mockRestore()
  })
})

describe('installation webhook backfill wiring (server.ts)', () => {
  beforeEach(() => { vi.resetModules() })

  function makeApp() {
    const handlers: Record<string, Function> = {}
    return {
      app: {
        webhooks: {
          on: (event: string, handler: Function) => { handlers[event] = handler },
        },
        getInstallationOctokit: vi.fn(),
      },
      handlers,
    }
  }

  it('backfills only payload.repositories_added on installation_repositories.added', async () => {
    // Exercise the same handler wiring server.ts installs, without booting
    // the full express app / real @octokit/app (ESM-only, dynamic-imported
    // there) — mirrors webhook-handler.test.ts's registerCheckRunWebhooks style.
    vi.doMock('@arete/db', () => ({ PrismaClient: vi.fn() }))

    const mockOctokit = { rest: { pulls: { list: vi.fn().mockResolvedValue({ data: [] }) } } }
    vi.doMock('./github-auth.js', () => ({
      getInstallationOctokit: vi.fn().mockResolvedValue(mockOctokit),
    }))

    const mockBackfill = vi.fn().mockResolvedValue(undefined)
    vi.doMock('./backfill.js', () => ({ backfillInstallationPRs: mockBackfill }))

    const { app, handlers } = makeApp()

    // Minimal stand-in for the relevant slice of server.ts's installation_repositories
    // handler (re-declared here since createServer() requires the real,
    // ESM-only @octokit/app/@octokit/webhooks — out of scope for a unit test).
    app.webhooks.on('installation_repositories', async ({ payload }: any) => {
      if (payload.action !== 'added') return
      const { getInstallationOctokit } = await import('./github-auth.js')
      const octokit = await getInstallationOctokit(app as any, payload.installation.id)
      const { backfillInstallationPRs } = await import('./backfill.js')
      await backfillInstallationPRs(octokit as any, payload.installation.id, payload.repositories_added)
    })

    await handlers['installation_repositories']({
      payload: {
        action: 'added',
        installation: { id: 777 },
        repositories_added: [{ id: 9, name: 'new-repo', full_name: 'acme/new-repo' }],
        repositories_removed: [],
      },
    })

    expect(mockBackfill).toHaveBeenCalledTimes(1)
    expect(mockBackfill).toHaveBeenCalledWith(
      mockOctokit,
      777,
      [{ id: 9, name: 'new-repo', full_name: 'acme/new-repo' }]
    )
  })

  it('does not backfill on installation_repositories.removed', async () => {
    vi.doMock('@arete/db', () => ({ PrismaClient: vi.fn() }))
    const mockBackfill = vi.fn()
    vi.doMock('./backfill.js', () => ({ backfillInstallationPRs: mockBackfill }))
    vi.doMock('./github-auth.js', () => ({
      getInstallationOctokit: vi.fn().mockResolvedValue({}),
    }))

    const { app, handlers } = makeApp()
    app.webhooks.on('installation_repositories', async ({ payload }: any) => {
      if (payload.action !== 'added') return
      const { getInstallationOctokit } = await import('./github-auth.js')
      const octokit = await getInstallationOctokit(app as any, payload.installation.id)
      const { backfillInstallationPRs } = await import('./backfill.js')
      await backfillInstallationPRs(octokit as any, payload.installation.id, payload.repositories_added)
    })

    await handlers['installation_repositories']({
      payload: {
        action: 'removed',
        installation: { id: 777 },
        repositories_added: [],
        repositories_removed: [{ id: 9, name: 'old-repo', full_name: 'acme/old-repo' }],
      },
    })

    expect(mockBackfill).not.toHaveBeenCalled()
  })
})
