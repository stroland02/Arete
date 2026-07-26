import { UnrecoverableError } from 'bullmq'
import { describe, expect, test, vi } from 'vitest'
import { applyApproval, processApprovalJob } from './approval-worker.js'
import { APPROVAL_QUEUE_NAME } from './queue.js'

const JOB = { approvalId: 'ap_1', reviewId: 'rev_1', command: 'terraform apply' }

describe('applyApproval', () => {
  test('POSTs the job to /approvals/apply and returns the parsed result', async () => {
    const calls: Array<{ url: string; init: any }> = []
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'applied', detail: 'ok', resumedRunId: 'run_9' }),
      } as any
    })

    const res = await applyApproval(JOB, { baseUrl: 'http://python.test', fetchImpl })

    expect(res).toEqual({ status: 'applied', detail: 'ok', resumedRunId: 'run_9' })
    expect(calls[0].url).toBe('http://python.test/approvals/apply')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body)).toEqual({
      approvalId: 'ap_1',
      reviewId: 'rev_1',
      command: 'terraform apply',
    })
  })

  test('throws on a non-2xx response so the job retries', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }) as any)
    await expect(applyApproval(JOB, { baseUrl: 'http://python.test', fetchImpl })).rejects.toThrow(/502/)
  })
})

describe('processApprovalJob', () => {
  test('resolves when apply returns "applied"', async () => {
    const apply = vi.fn(async () => ({ status: 'applied' as const, detail: 'done', resumedRunId: 'run_1' }))
    await expect(processApprovalJob(JOB, { apply })).resolves.toBeUndefined()
    expect(apply).toHaveBeenCalledWith(JOB)
  })

  test('throws UnrecoverableError (terminal, no retry) when apply returns "failed"', async () => {
    // 200 {status:"failed"} means the command ran and deterministically failed —
    // retrying is wasteful, so BullMQ must NOT retry. UnrecoverableError signals that.
    const apply = vi.fn(async () => ({ status: 'failed' as const, detail: 'terraform plan error' }))
    const err = await processApprovalJob(JOB, { apply }).catch((e) => e)
    expect(err).toBeInstanceOf(UnrecoverableError)
    expect(String(err)).toMatch(/terraform plan error/)
  })

  test('a transport/non-2xx throw is a REGULAR retryable Error, not UnrecoverableError', async () => {
    // non-2xx / timeout / network (surfaced by applyApproval throwing a plain Error)
    // must stay retryable → a regular Error so DEFAULT_JOB_OPTIONS backoff kicks in.
    const apply = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const err = await processApprovalJob(JOB, { apply }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(UnrecoverableError)
    expect(String(err)).toMatch(/ECONNREFUSED/)
  })
})

// Review finding: startApprovalWorker built its Worker without the
// `telemetry` option (unlike startReviewWorker in worker.ts) and never
// called recordQueueJob, so approval jobs got no consumer-side span/trace
// link and never populated the arete.queue.jobs metric. These tests mock
// `bullmq`/`ioredis`/`./observability.js`, mirroring queue.test.ts's
// "queue telemetry (bullmq-otel)" pattern, to cover the fix without a real
// Redis connection.
describe('startApprovalWorker telemetry + queue-job metrics (review finding)', () => {
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

    const { startApprovalWorker } = await import('./approval-worker.js')
    startApprovalWorker()

    expect(workerCtorOpts).toHaveLength(1)
    expect(workerCtorOpts[0].telemetry).toBeDefined()
    expect(workerCtorOpts[0].telemetry.constructor.name).toBe('BullMQOtel')

    vi.doUnmock('bullmq')
    vi.doUnmock('ioredis')
    vi.resetModules()
  })

  test('records a "completed" queue-job outcome on job completion, keyed by the approval-exec queue', async () => {
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
    vi.doMock('./observability.js', () => ({ recordQueueJob }))

    const { startApprovalWorker } = await import('./approval-worker.js')
    startApprovalWorker()

    handlers.completed({ id: 'job-1' })

    expect(recordQueueJob).toHaveBeenCalledWith(APPROVAL_QUEUE_NAME, 'completed')

    vi.doUnmock('bullmq')
    vi.doUnmock('ioredis')
    vi.doUnmock('./observability.js')
    vi.resetModules()
  })

  test('records a "failed" queue-job outcome on job failure — no job id/repo/PR on the metric', async () => {
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
    vi.doMock('./observability.js', () => ({ recordQueueJob }))

    const { startApprovalWorker } = await import('./approval-worker.js')
    startApprovalWorker()

    handlers.failed({ id: 'job-2' }, new Error('boom'))

    // Closed-set attributes only: queue name + outcome. No job id/repo/PR.
    expect(recordQueueJob).toHaveBeenCalledTimes(1)
    expect(recordQueueJob).toHaveBeenCalledWith(APPROVAL_QUEUE_NAME, 'failed')

    vi.doUnmock('bullmq')
    vi.doUnmock('ioredis')
    vi.doUnmock('./observability.js')
    vi.resetModules()
  })
})
