import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCloneContext } from './worker.js'

describe('buildCloneContext', () => {
  it('builds an https clone URL and carries the installation token/id', () => {
    const result = buildCloneContext('acme/api', 42, 'ghs_abc123')
    expect(result).toEqual({
      cloneUrl: 'https://github.com/acme/api.git',
      installationToken: 'ghs_abc123',
      installationId: 42,
    })
  })
})

// webhook-handler.ts:114 routes >50-changed-file PRs to the 'heavy' lane,
// which enqueueReviewJob (queue.ts) maps onto the REVIEW_QUEUE_HEAVY_NAME
// ('review-pr-heavy') queue. Without a consumer on that queue, those jobs
// sit enqueued forever and the PR is never reviewed — silently. This suite
// pins that startReviewWorkers() actually starts a running BullMQ Worker on
// every queue a PR can be routed to, with a bounded (non-zero, non-runaway)
// concurrency on each lane.
describe('review queue consumers (no orphaned lane)', () => {
  const workerCtorCalls: Array<{ queueName: string; concurrency: number }> = []

  beforeEach(() => {
    vi.resetModules()
    workerCtorCalls.length = 0
    vi.doMock('bullmq', () => ({
      Worker: class {
        constructor(queueName: string, _processor: unknown, opts: any) {
          workerCtorCalls.push({ queueName, concurrency: opts?.concurrency })
        }
        on() { return this }
      },
      UnrecoverableError: class UnrecoverableError extends Error {},
    }))
    vi.doMock('ioredis', () => ({ Redis: class { quit = async () => {} } }))
    vi.doMock('bullmq-otel', () => ({ BullMQOtel: class {} }))
    vi.doMock('./github-auth.js', () => ({ createApp: vi.fn(), getInstallationOctokit: vi.fn(), getInstallationToken: vi.fn() }))
    vi.doMock('./approval-worker.js', () => ({ startApprovalWorker: vi.fn() }))
    vi.doMock('./fix/queue-consumer.js', () => ({ startFixWorker: vi.fn() }))
  })

  it('starts a running Worker on every queue name a PR can be routed to (fast AND heavy)', async () => {
    const { REVIEW_QUEUE_NAME, REVIEW_QUEUE_HEAVY_NAME } = await import('./queue.js')
    const { startReviewWorkers } = await import('./worker.js')

    startReviewWorkers()

    const consumedQueueNames = workerCtorCalls.map((c) => c.queueName)
    // Both lanes webhook-handler.ts can route a PR to (webhook-handler.ts:114)
    // must have a running consumer — a queue with no Worker silently drops
    // every job enqueued to it.
    expect(consumedQueueNames).toContain(REVIEW_QUEUE_NAME)
    expect(consumedQueueNames).toContain(REVIEW_QUEUE_HEAVY_NAME)
  })

  it('bounds the heavy lane to its own non-zero concurrency (no unbounded fan-out)', async () => {
    const { REVIEW_QUEUE_NAME, REVIEW_QUEUE_HEAVY_NAME, REVIEW_QUEUE_CONCURRENCY } = await import('./queue.js')
    const { startReviewWorkers } = await import('./worker.js')

    startReviewWorkers()

    const heavyCall = workerCtorCalls.find((c) => c.queueName === REVIEW_QUEUE_HEAVY_NAME)
    const fastCall = workerCtorCalls.find((c) => c.queueName === REVIEW_QUEUE_NAME)
    expect(heavyCall).toBeDefined()
    expect(fastCall?.concurrency).toBe(REVIEW_QUEUE_CONCURRENCY)
    expect(heavyCall!.concurrency).toBeGreaterThan(0)
    expect(heavyCall!.concurrency).toBeLessThanOrEqual(REVIEW_QUEUE_CONCURRENCY)
  })
})
