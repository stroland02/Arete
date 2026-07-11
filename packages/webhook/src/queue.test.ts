import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock bullmq/ioredis so this is a pure config test — no real Redis needed.
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({ quit: vi.fn() })),
}))

const addMock = vi.fn().mockResolvedValue({ id: 'job-1' })
const closeMock = vi.fn().mockResolvedValue(undefined)
// vi.mock factories for a given module are memoized for the whole file (they
// don't re-run just because vi.resetModules() clears the module cache), so
// this mock constructor must be a stable, file-scoped reference that tests
// clear via mockClear() rather than expecting a fresh instance per test.
const QueueMock = vi.fn().mockImplementation(() => ({ add: addMock, close: closeMock }))
vi.mock('bullmq', () => ({
  Queue: QueueMock,
}))

describe('queue configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    addMock.mockClear()
    QueueMock.mockClear()
  })

  afterEach(async () => {
    const { closeReviewQueue } = await import('./queue.js')
    await closeReviewQueue()
  })

  it('exposes a bounded concurrency limit for the review-pr queue', async () => {
    const { REVIEW_QUEUE_CONCURRENCY, REVIEW_QUEUE_NAME } = await import('./queue.js')

    // A burst of PRs must not fan out into unbounded concurrent LLM calls —
    // this is the backpressure knob worker.ts passes to BullMQ's Worker.
    expect(REVIEW_QUEUE_CONCURRENCY).toBeGreaterThan(0)
    expect(REVIEW_QUEUE_CONCURRENCY).toBeLessThanOrEqual(10)
    expect(REVIEW_QUEUE_NAME).toBe('review-pr')
  })

  it('enqueueReviewJob adds a job to the review-pr queue with the given data', async () => {
    const { enqueueReviewJob, REVIEW_QUEUE_NAME } = await import('./queue.js')

    const data = {
      provider: 'github' as const,
      kind: 'pull_request' as const,
      owner: 'acme',
      repo: 'api',
      repositoryExternalId: 123,
      fullName: 'acme/api',
      installationId: 777,
      prNumber: 1,
      headSha: 'abcdef',
    }

    await enqueueReviewJob(data)

    expect(addMock).toHaveBeenCalledWith(REVIEW_QUEUE_NAME, data, expect.any(Object))
  })

  it('lazily constructs the queue — importing the module alone does not touch Redis', async () => {
    await import('./queue.js')
    expect(QueueMock).not.toHaveBeenCalled()
  })
})
