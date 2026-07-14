import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TelemetrySnapshot } from './types.js'

// Same vi.doMock + vi.resetModules + dynamic import pattern used by
// pipeline.integration.test.ts — persistence.ts imports the real prisma
// client from db.ts at module load time, so it must be intercepted before
// the module under test is ever imported.
function makePrismaMock() {
  const installationFindUnique = vi.fn()
  const installationUpsert = vi.fn()
  const telemetrySnapshotRecordUpsert = vi.fn()
  const repositoryFindUnique = vi.fn()
  const agentMemoryFindMany = vi.fn()

  class PrismaClient {
    installation = { findUnique: installationFindUnique, upsert: installationUpsert }
    telemetrySnapshotRecord = { upsert: telemetrySnapshotRecordUpsert }
    repository = { findUnique: repositoryFindUnique }
    agentMemory = { findMany: agentMemoryFindMany }
  }

  return {
    PrismaClient,
    installationFindUnique,
    installationUpsert,
    telemetrySnapshotRecordUpsert,
    repositoryFindUnique,
    agentMemoryFindMany,
  }
}

async function loadPersistence(mocks: ReturnType<typeof makePrismaMock>) {
  vi.resetModules()
  vi.doMock('@arete/db', () => ({ PrismaClient: mocks.PrismaClient }))
  vi.doMock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }))
  return import('./persistence.js')
}

const SNAPSHOT: TelemetrySnapshot = {
  provider: 'sentry',
  source_ref: 'acme/api',
  summary_text: '3 new issues this week',
  metrics: { issue_count: 3 },
  links: ['https://sentry.io/issues/123'],
  fetched_at: '2026-07-12T00:00:00.000Z',
}

describe('persistTelemetrySnapshots', () => {
  let mocks: ReturnType<typeof makePrismaMock>

  beforeEach(() => {
    mocks = makePrismaMock()
  })

  it('upserts one row per snapshot, scoped to the resolved installation UUID', async () => {
    mocks.installationFindUnique.mockResolvedValue({ id: 'inst-uuid-1' })
    const { persistTelemetrySnapshots } = await loadPersistence(mocks)

    await persistTelemetrySnapshots({
      provider: 'github',
      installationExternalId: 42,
      snapshots: [SNAPSHOT],
    })

    expect(mocks.installationFindUnique).toHaveBeenCalledWith({
      where: { provider_externalId: { provider: 'github', externalId: 42 } },
    })
    expect(mocks.telemetrySnapshotRecordUpsert).toHaveBeenCalledTimes(1)
    const call = mocks.telemetrySnapshotRecordUpsert.mock.calls[0][0]
    expect(call.where).toEqual({
      installationId_provider_sourceRef: {
        installationId: 'inst-uuid-1',
        provider: 'sentry',
        sourceRef: 'acme/api',
      },
    })
    expect(call.create.summaryText).toBe('3 new issues this week')
    expect(call.create.metrics).toEqual({ issue_count: 3 })
    expect(call.update.summaryText).toBe('3 new issues this week')
  })

  it('silently no-ops when the installation is not found (never blocks/fails a review)', async () => {
    mocks.installationFindUnique.mockResolvedValue(null)
    const { persistTelemetrySnapshots } = await loadPersistence(mocks)

    await expect(
      persistTelemetrySnapshots({ provider: 'github', installationExternalId: 42, snapshots: [SNAPSHOT] })
    ).resolves.toBeUndefined()

    expect(mocks.telemetrySnapshotRecordUpsert).not.toHaveBeenCalled()
  })

  it('never queries the db for an empty snapshot list', async () => {
    const { persistTelemetrySnapshots } = await loadPersistence(mocks)

    await persistTelemetrySnapshots({ provider: 'github', installationExternalId: 42, snapshots: [] })

    expect(mocks.installationFindUnique).not.toHaveBeenCalled()
    expect(mocks.telemetrySnapshotRecordUpsert).not.toHaveBeenCalled()
  })
})

describe('persistInstallation', () => {
  let mocks: ReturnType<typeof makePrismaMock>

  beforeEach(() => {
    mocks = makePrismaMock()
  })

  it('upserts the Installation row keyed on (provider, externalId) and returns its id', async () => {
    mocks.installationUpsert.mockResolvedValue({ id: 'inst-uuid-1' })
    const { persistInstallation } = await loadPersistence(mocks)

    const id = await persistInstallation({ provider: 'github', installationExternalId: 12345, owner: 'acme' })

    expect(id).toBe('inst-uuid-1')
    expect(mocks.installationUpsert).toHaveBeenCalledWith({
      where: { provider_externalId: { provider: 'github', externalId: 12345 } },
      create: { provider: 'github', externalId: 12345, owner: 'acme' },
      update: { owner: 'acme' },
    })
  })

  it('is idempotent on re-delivery and tracks an owner rename in the update path', async () => {
    mocks.installationUpsert.mockResolvedValue({ id: 'inst-uuid-1' })
    const { persistInstallation } = await loadPersistence(mocks)

    await persistInstallation({ provider: 'github', installationExternalId: 12345, owner: 'acme' })
    await persistInstallation({ provider: 'github', installationExternalId: 12345, owner: 'acme-renamed' })

    expect(mocks.installationUpsert).toHaveBeenCalledTimes(2)
    expect(mocks.installationUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ update: { owner: 'acme-renamed' } })
    )
  })
})

describe('fetchProjectMemories', () => {
  let mocks: ReturnType<typeof makePrismaMock>

  beforeEach(() => {
    mocks = makePrismaMock()
  })

  it('returns active memory bodies for an existing repo, most recent first', async () => {
    mocks.repositoryFindUnique.mockResolvedValue({ id: 'repo-uuid-1' })
    mocks.agentMemoryFindMany.mockResolvedValue([
      { body: 'Use tabs, not spaces.' },
      { body: 'Always run the linter before committing.' },
    ])
    const { fetchProjectMemories } = await loadPersistence(mocks)

    const result = await fetchProjectMemories('github', 1)

    expect(result).toEqual(['Use tabs, not spaces.', 'Always run the linter before committing.'])
    expect(mocks.agentMemoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repositoryId: 'repo-uuid-1', status: 'active' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    )
  })

  it('returns an empty array when no Repository row exists for that provider/externalId', async () => {
    mocks.repositoryFindUnique.mockResolvedValue(null)
    const { fetchProjectMemories } = await loadPersistence(mocks)

    const result = await fetchProjectMemories('github', 999)

    expect(result).toEqual([])
    expect(mocks.agentMemoryFindMany).not.toHaveBeenCalled()
  })

  it('returns an empty array when the repo has no active memories', async () => {
    mocks.repositoryFindUnique.mockResolvedValue({ id: 'repo-uuid-1' })
    mocks.agentMemoryFindMany.mockResolvedValue([])
    const { fetchProjectMemories } = await loadPersistence(mocks)

    const result = await fetchProjectMemories('github', 1)

    expect(result).toEqual([])
  })

  it('caps the query at 20 results', async () => {
    mocks.repositoryFindUnique.mockResolvedValue({ id: 'repo-uuid-1' })
    mocks.agentMemoryFindMany.mockResolvedValue([])
    const { fetchProjectMemories } = await loadPersistence(mocks)

    await fetchProjectMemories('github', 1)

    expect(mocks.agentMemoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 })
    )
  })
})
