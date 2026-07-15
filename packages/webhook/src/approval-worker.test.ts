import { describe, expect, test, vi } from 'vitest'
import { applyApproval, processApprovalJob } from './approval-worker.js'

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

  test('throws when apply returns "failed" so DEFAULT_JOB_OPTIONS backoff retries', async () => {
    const apply = vi.fn(async () => ({ status: 'failed' as const, detail: 'terraform plan error' }))
    await expect(processApprovalJob(JOB, { apply })).rejects.toThrow(/terraform plan error/)
  })

  test('propagates a transport throw (also retryable)', async () => {
    const apply = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(processApprovalJob(JOB, { apply })).rejects.toThrow(/ECONNREFUSED/)
  })
})
