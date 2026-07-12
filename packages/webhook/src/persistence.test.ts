import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TelemetrySnapshot } from './types.js'

// Same vi.doMock + vi.resetModules + dynamic import pattern used by
// pipeline.integration.test.ts — persistence.ts imports the real prisma
// client from db.ts at module load time, so it must be intercepted before
// the module under test is ever imported.
function makePrismaMock() {
  const installationFindUnique = vi.fn()
  const telemetrySnapshotRecordUpsert = vi.fn()

  class PrismaClient {
    installation = { findUnique: installationFindUnique }
    telemetrySnapshotRecord = { upsert: telemetrySnapshotRecordUpsert }
  }

  return { PrismaClient, installationFindUnique, telemetrySnapshotRecordUpsert }
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
