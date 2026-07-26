import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock bullmq/ioredis so this is a pure config test — no real Redis needed.
// queue.ts imports the named `Redis` export (not the default) to avoid a
// nodenext CJS-interop type error — see the comment in queue.ts — so both
// bindings are mocked here.
const RedisMock = vi.fn().mockImplementation(() => ({ quit: vi.fn() }))
vi.mock('ioredis', () => ({
  default: RedisMock,
  Redis: RedisMock,
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

  // Fix drives ran inline (`void driveFix(...)`) on the webhook HTTP process
  // with no concurrency cap at all — this is the bounded queue that replaces
  // that. Lower than review's 5: a fix drive does a full repo checkout.
  it('exposes a bounded concurrency limit for the fix-drive queue, lower than review', async () => {
    const { FIX_QUEUE_CONCURRENCY, FIX_QUEUE_NAME, REVIEW_QUEUE_CONCURRENCY } = await import('./queue.js')

    expect(FIX_QUEUE_NAME).toBe('fix-drive')
    expect(FIX_QUEUE_CONCURRENCY).toBeGreaterThan(0)
    expect(FIX_QUEUE_CONCURRENCY).toBeLessThan(REVIEW_QUEUE_CONCURRENCY)
  })

  it('enqueueFixDrive adds a job to the fix-drive queue with the given workItemId', async () => {
    const { enqueueFixDrive, FIX_QUEUE_NAME } = await import('./queue.js')

    await enqueueFixDrive({ workItemId: 'wi-1' })

    expect(addMock).toHaveBeenCalledWith(FIX_QUEUE_NAME, { workItemId: 'wi-1' }, expect.any(Object))
  })
})

describe('queue telemetry (bullmq-otel)', () => {
  it('constructs every Queue with a BullMQOtel telemetry instance', async () => {
    vi.resetModules()
    const queueCtorOpts: any[] = []
    vi.doMock('bullmq', () => ({
      Queue: class {
        constructor(_name: string, opts: unknown) {
          queueCtorOpts.push(opts)
        }
        async add() { return { id: 'job-1' } }
        async close() {}
      },
    }))
    vi.doMock('ioredis', () => ({ Redis: class { quit = async () => {} } }))

    const { getReviewQueue, getApprovalQueue, getFixQueue } = await import('./queue.js')
    getReviewQueue('fast')
    getReviewQueue('heavy')
    getApprovalQueue()
    getFixQueue()

    expect(queueCtorOpts).toHaveLength(4)
    for (const opts of queueCtorOpts) {
      expect(opts.telemetry).toBeDefined()
      expect(opts.telemetry.constructor.name).toBe('BullMQOtel')
    }

    vi.doUnmock('bullmq')
    vi.doUnmock('ioredis')
    vi.resetModules()
  })
})
