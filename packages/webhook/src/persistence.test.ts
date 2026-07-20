import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentStatus, TelemetrySnapshot } from './types.js'

// Same vi.doMock + vi.resetModules + dynamic import pattern used by
// pipeline.integration.test.ts — persistence.ts imports the real prisma
// client from db.ts at module load time, so it must be intercepted before
// the module under test is ever imported.
function makePrismaMock() {
  const installationFindUnique = vi.fn()
  const installationUpsert = vi.fn()
  const installationUpdate = vi.fn()
  const telemetrySnapshotRecordUpsert = vi.fn()
  const repositoryFindUnique = vi.fn()
  const repositoryUpsert = vi.fn()
  const reviewFindUnique = vi.fn()
  const reviewCreate = vi.fn()
  const reviewCommentFindFirst = vi.fn()
  const reviewCommentUpdate = vi.fn()
  const agentMemoryFindMany = vi.fn()
  // persistReview now fires an outbound review.created webhook via
  // PrismaWebhookStore, which reads webhookEndpoint and writes webhookDelivery.
  // Model both on the fake so the emit no-ops cleanly (no endpoints → no
  // delivery) instead of throwing on an undefined delegate.
  const webhookEndpointFindMany = vi.fn().mockResolvedValue([])
  const webhookDeliveryCreate = vi.fn()

  class PrismaClient {
    installation = {
      findUnique: installationFindUnique,
      upsert: installationUpsert,
      update: installationUpdate,
    }
    telemetrySnapshotRecord = { upsert: telemetrySnapshotRecordUpsert }
    repository = { findUnique: repositoryFindUnique, upsert: repositoryUpsert }
    review = { findUnique: reviewFindUnique, create: reviewCreate }
    reviewComment = { findFirst: reviewCommentFindFirst, update: reviewCommentUpdate }
    agentMemory = { findMany: agentMemoryFindMany }
    webhookEndpoint = { findMany: webhookEndpointFindMany }
    webhookDelivery = { create: webhookDeliveryCreate }
  }

  return {
    PrismaClient,
    installationFindUnique,
    installationUpsert,
    installationUpdate,
    telemetrySnapshotRecordUpsert,
    repositoryFindUnique,
    repositoryUpsert,
    reviewFindUnique,
    reviewCreate,
    reviewCommentFindFirst,
    reviewCommentUpdate,
    agentMemoryFindMany,
    webhookEndpointFindMany,
    webhookDeliveryCreate,
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

describe('persistReview', () => {
  let mocks: ReturnType<typeof makePrismaMock>

  const BASE_PARAMS = {
    provider: 'github' as const,
    installationExternalId: 1,
    repositoryExternalId: 1,
    owner: 'acme',
    name: 'api',
    fullName: 'acme/api',
    prNumber: 1,
    headSha: 'sha1',
  }

  function makeResult(comments: any[]) {
    return {
      pr_context: {} as any,
      file_reviews: comments.length
        ? [{ path: comments[0].path, comments, summary: 's' }]
        : [],
      overall_summary: 'ok',
      risk_level: 'low' as const,
      total_comments: comments.length,
    }
  }

  beforeEach(() => {
    mocks = makePrismaMock()
    mocks.installationUpsert.mockResolvedValue({ id: 'inst-uuid-1' })
    mocks.repositoryUpsert.mockResolvedValue({ id: 'repo-uuid-1' })
    mocks.reviewFindUnique.mockResolvedValue(null)
    mocks.reviewCreate.mockResolvedValue({ id: 'review-uuid-1' })
    mocks.reviewCommentFindFirst.mockResolvedValue(null)
  })

  it('persists agent_statuses faithfully onto the review row', async () => {
    const { persistReview } = await loadPersistence(mocks)
    const statuses: AgentStatus[] = [
      { agent: 'security', status: 'done', summary: 'no findings', confidence: 0.9, blockers: [] },
      { agent: 'performance', status: 'blocked', summary: 'timeout', confidence: 0.2, blockers: ['llm timeout'] },
    ]

    await persistReview({
      ...BASE_PARAMS,
      result: { ...makeResult([]), agent_statuses: statuses },
    })

    expect(mocks.reviewCreate.mock.calls[0][0].data.agentStatuses).toEqual(statuses)
  })

  it('persists an EMPTY agent_statuses as [] — real "no agent ran" state, never synthesized', async () => {
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: { ...makeResult([]), agent_statuses: [] },
    })

    expect(mocks.reviewCreate.mock.calls[0][0].data.agentStatuses).toEqual([])
  })

  it('omits agentStatuses when the response carries none (older agents) — column stays NULL', async () => {
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({ ...BASE_PARAMS, result: makeResult([]) })

    expect(mocks.reviewCreate.mock.calls[0][0].data.agentStatuses).toBeUndefined()
  })

  it('writes noiseState/escalateOn/threshold from the comment data onto each created row', async () => {
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([{
        path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality',
        noise_state: 'SILENCED', escalate_on: null, threshold: null,
      }]),
    })

    const createArgs = mocks.reviewCreate.mock.calls[0][0]
    expect(createArgs.data.comments.createMany.data[0]).toMatchObject({
      noiseState: 'SILENCED',
      escalateOn: null,
      threshold: null,
    })
  })

  it('defaults noiseState to OPEN when the comment carries no noise fields', async () => {
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([
        { path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality' },
      ]),
    })

    const createArgs = mocks.reviewCreate.mock.calls[0][0]
    expect(createArgs.data.comments.createMany.data[0].noiseState).toBe('OPEN')
  })

  it('creates a fresh row with no recurrence check when there is no prior UNDER_OBSERVATION match', async () => {
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([{
        path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality',
        noise_state: 'UNDER_OBSERVATION', escalate_on: 'additional_events', threshold: 3,
      }]),
    })

    expect(mocks.reviewCommentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          noiseState: 'UNDER_OBSERVATION',
          path: 'src/auth.py',
          category: 'quality',
          review: { repositoryId: 'repo-uuid-1' },
        },
        // Deterministic escalation: always accumulate onto the OLDEST prior
        // row, since each review also persists its own UNDER_OBSERVATION row.
        orderBy: { createdAt: 'asc' },
      })
    )
    expect(mocks.reviewCommentUpdate).not.toHaveBeenCalled()
  })

  it('increments occurrenceCount on a matching prior UNDER_OBSERVATION comment', async () => {
    mocks.reviewCommentFindFirst.mockResolvedValue({
      id: 'comment-uuid-1', occurrenceCount: 1, threshold: 3,
    })
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([{
        path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality',
        noise_state: 'UNDER_OBSERVATION', escalate_on: 'additional_events', threshold: 3,
      }]),
    })

    expect(mocks.reviewCommentUpdate).toHaveBeenCalledWith({
      where: { id: 'comment-uuid-1' },
      data: { occurrenceCount: 2, noiseState: 'UNDER_OBSERVATION' },
    })
  })

  it('escalates to ESCALATED once the incremented count reaches the threshold', async () => {
    mocks.reviewCommentFindFirst.mockResolvedValue({
      id: 'comment-uuid-1', occurrenceCount: 2, threshold: 3,
    })
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([{
        path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality',
        noise_state: 'UNDER_OBSERVATION', escalate_on: 'additional_events', threshold: 3,
      }]),
    })

    expect(mocks.reviewCommentUpdate).toHaveBeenCalledWith({
      where: { id: 'comment-uuid-1' },
      data: { occurrenceCount: 3, noiseState: 'ESCALATED' },
    })
  })

  it('does not run a recurrence check for OPEN/SILENCED comments', async () => {
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([{
        path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality',
        noise_state: 'SILENCED',
      }]),
    })

    expect(mocks.reviewCommentFindFirst).not.toHaveBeenCalled()
  })
})
