import { describe, expect, test, vi } from 'vitest'
import { processFixJob } from './queue-consumer.js'
import { FIX_QUEUE_NAME } from '../queue.js'

const JOB = { workItemId: 'wi-1' }

// All of these exercise behavior downstream of the cooldown check, so they
// stub checkCooldown to 'allowed' — the cooldown-specific behavior has its
// own describe block below.
const cooldownAllowed = async () => ({ allowed: true })

describe('processFixJob', () => {
  test('invokes driveFix exactly once with the job workItemId and the built deps', async () => {
    const fakeDeps = { marker: 'fake-deps' } as any
    const drive = vi.fn().mockResolvedValue({ ok: true, status: 'fixed' })
    const buildDeps = vi.fn().mockReturnValue(fakeDeps)

    const result = await processFixJob(JOB, { driveFix: drive, buildDeps, checkCooldown: cooldownAllowed })

    expect(drive).toHaveBeenCalledTimes(1)
    expect(drive).toHaveBeenCalledWith('wi-1', fakeDeps)
    expect(result).toEqual({ ok: true, status: 'fixed' })
  })

  // driveFix's own contract is "never throws — every failure path lands the
  // container in fix_failed and returns the WorkItem to open" (trigger.ts).
  // A BullMQ job handler that rethrows on a `fix_failed` *result* would give
  // BullMQ its own backoff-retry of a business failure — racing a second full
  // checkout + LLM call against the cooldown Task 6 adds on top of this
  // queue. This job must resolve (not reject) on a fix_failed outcome.
  test('resolves normally (does not throw) when driveFix reports fix_failed', async () => {
    const drive = vi.fn().mockResolvedValue({ ok: true, status: 'fix_failed', reason: 'no model' })
    await expect(
      processFixJob(JOB, { driveFix: drive, buildDeps: () => ({} as any), checkCooldown: cooldownAllowed }),
    ).resolves.toEqual({
      ok: true,
      status: 'fix_failed',
      reason: 'no model',
    })
  })

  test('resolves normally when the work item or its container is gone (nothing to retry)', async () => {
    const drive = vi.fn().mockResolvedValue({ ok: false, reason: 'not_found' })
    await expect(
      processFixJob(JOB, { driveFix: drive, buildDeps: () => ({} as any), checkCooldown: cooldownAllowed }),
    ).resolves.toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('processFixJob cooldown enforcement', () => {
  test('drops the job without invoking driveFix when the cooldown is active', async () => {
    const drive = vi.fn()
    const checkCooldown = vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 120 })

    const result = await processFixJob(JOB, { driveFix: drive, buildDeps: () => ({} as any), checkCooldown })

    expect(checkCooldown).toHaveBeenCalledWith('wi-1')
    expect(drive).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, reason: 'cooldown', retryAfterSeconds: 120 })
  })

  test('runs driveFix as normal when the cooldown allows it', async () => {
    const drive = vi.fn().mockResolvedValue({ ok: true, status: 'fixed' })
    const checkCooldown = vi.fn().mockResolvedValue({ allowed: true })

    const result = await processFixJob(JOB, { driveFix: drive, buildDeps: () => ({} as any), checkCooldown })

    expect(drive).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, status: 'fixed' })
  })
})

// Mirrors approval-worker.test.ts's "startApprovalWorker telemetry + queue-job
// metrics" block — same review finding class (a queue built without
// BullMQOtel silently loses the producer→consumer trace link).
describe('startFixWorker telemetry + queue-job metrics', () => {
  test('constructs the Worker with a BullMQOtel telemetry instance', async () => {
    vi.resetModules()
    const workerCtorOpts: any[] = []
    vi.doMock('bullmq', async (importOriginal) => {
      const actual = await importOriginal<typeof import('bullmq')>()
      return {
        ...actual,
        Worker: class {
          constructor(_name: string, _processor: unknown, opts: unknown) {
            workerCtorOpts.push(opts)
          }
          on() {}
        },
      }
    })
    vi.doMock('ioredis', () => ({ Redis: class {} }))

    const { startFixWorker } = await import('./queue-consumer.js')
    startFixWorker()

    expect(workerCtorOpts).toHaveLength(1)
    expect(workerCtorOpts[0].telemetry).toBeDefined()
    expect(workerCtorOpts[0].telemetry.constructor.name).toBe('BullMQOtel')

    vi.doUnmock('bullmq')
    vi.doUnmock('ioredis')
    vi.resetModules()
  })

  test('records a "completed" queue-job outcome on job completion, keyed by the fix-drive queue', async () => {
    vi.resetModules()
    const handlers: Record<string, (...args: any[]) => void> = {}
    vi.doMock('bullmq', async (importOriginal) => {
      const actual = await importOriginal<typeof import('bullmq')>()
      return {
        ...actual,
        Worker: class {
          constructor(_name: string, _processor: unknown, _opts: unknown) {}
          on(event: string, cb: (...args: any[]) => void) {
            handlers[event] = cb
          }
        },
      }
    })
    vi.doMock('ioredis', () => ({ Redis: class {} }))
    const recordQueueJob = vi.fn()
    vi.doMock('../observability.js', () => ({ recordQueueJob }))

    const { startFixWorker } = await import('./queue-consumer.js')
    startFixWorker()

    handlers.completed({ id: 'job-1' })

    expect(recordQueueJob).toHaveBeenCalledWith(FIX_QUEUE_NAME, 'completed')

    vi.doUnmock('bullmq')
    vi.doUnmock('ioredis')
    vi.doUnmock('../observability.js')
    vi.resetModules()
  })

  test('records a "failed" queue-job outcome on job failure — no job id/workItemId on the metric', async () => {
    vi.resetModules()
    const handlers: Record<string, (...args: any[]) => void> = {}
    vi.doMock('bullmq', async (importOriginal) => {
      const actual = await importOriginal<typeof import('bullmq')>()
      return {
        ...actual,
        Worker: class {
          constructor(_name: string, _processor: unknown, _opts: unknown) {}
          on(event: string, cb: (...args: any[]) => void) {
            handlers[event] = cb
          }
        },
      }
    })
    vi.doMock('ioredis', () => ({ Redis: class {} }))
    const recordQueueJob = vi.fn()
    vi.doMock('../observability.js', () => ({ recordQueueJob }))

    const { startFixWorker } = await import('./queue-consumer.js')
    startFixWorker()

    handlers.failed({ id: 'job-2' }, new Error('boom'))

    expect(recordQueueJob).toHaveBeenCalledTimes(1)
    expect(recordQueueJob).toHaveBeenCalledWith(FIX_QUEUE_NAME, 'failed')

    vi.doUnmock('bullmq')
    vi.doUnmock('ioredis')
    vi.doUnmock('../observability.js')
    vi.resetModules()
  })
})
