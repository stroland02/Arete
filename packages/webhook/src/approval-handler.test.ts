import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fakes the shared prisma client and the approval queue so executeApproval can
// be driven without a real Postgres or Redis. We assert the DB transition
// (updateMany to EXECUTED + executedAt) AND the follow-on enqueue — not just a
// return value — because "make it real" means the endpoint must actually
// change persisted state and trigger downstream work.
function setup(opts: {
  findUnique?: any
  updateManyCount?: number
  secondFindUnique?: any
}) {
  const findUnique = vi.fn()
    .mockResolvedValueOnce(opts.findUnique ?? null)
    .mockResolvedValueOnce(opts.secondFindUnique ?? opts.findUnique ?? null)
  const updateMany = vi.fn().mockResolvedValue({ count: opts.updateManyCount ?? 1 })
  vi.doMock('./db.js', () => ({
    prisma: { approvalPrompt: { findUnique, updateMany } },
  }))
  const enqueueApprovalExecution = vi.fn().mockResolvedValue({ id: 'job-1' })
  vi.doMock('./queue.js', () => ({ enqueueApprovalExecution }))
  return { findUnique, updateMany, enqueueApprovalExecution }
}

describe('executeApproval', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns not_found and enqueues nothing when the approval does not exist', async () => {
    const { updateMany, enqueueApprovalExecution } = setup({ findUnique: null })
    const { executeApproval } = await import('./approval-handler.js')

    const result = await executeApproval('missing-id')

    expect(result).toEqual({ outcome: 'not_found' })
    expect(updateMany).not.toHaveBeenCalled()
    expect(enqueueApprovalExecution).not.toHaveBeenCalled()
  })

  it('refuses to execute a REJECTED approval (no DB write, no enqueue)', async () => {
    const { updateMany, enqueueApprovalExecution } = setup({
      findUnique: { id: 'a1', reviewId: 'r1', command: 'rm -rf /', status: 'REJECTED', executedAt: null },
    })
    const { executeApproval } = await import('./approval-handler.js')

    const result = await executeApproval('a1')

    expect(result).toMatchObject({ outcome: 'rejected', status: 'REJECTED' })
    expect(updateMany).not.toHaveBeenCalled()
    expect(enqueueApprovalExecution).not.toHaveBeenCalled()
  })

  it('transitions a PENDING approval to EXECUTED and enqueues the command (the real follow-on)', async () => {
    const { updateMany, enqueueApprovalExecution } = setup({
      findUnique: {
        id: 'a1', reviewId: 'r1', command: 'aws ecs update-service --force-new-deployment',
        status: 'PENDING', executedAt: null,
      },
      updateManyCount: 1,
    })
    const { executeApproval } = await import('./approval-handler.js')

    const result = await executeApproval('a1')

    // DB state actually changed: conditional transition to EXECUTED + timestamp.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', executedAt: null },
      data: expect.objectContaining({ status: 'EXECUTED', executedAt: expect.any(Date) }),
    })
    // Real follow-on work enqueued with the saved command.
    expect(enqueueApprovalExecution).toHaveBeenCalledWith({
      approvalId: 'a1',
      reviewId: 'r1',
      command: 'aws ecs update-service --force-new-deployment',
    })
    expect(result).toMatchObject({ outcome: 'executed', approvalId: 'a1' })
    if (result.outcome === 'executed') expect(result.executedAt).toBeInstanceOf(Date)
  })

  it('is idempotent: an already-executed approval is not re-enqueued', async () => {
    const alreadyAt = new Date('2026-07-14T00:00:00Z')
    const { updateMany, enqueueApprovalExecution } = setup({
      findUnique: {
        id: 'a1', reviewId: 'r1', command: 'echo hi', status: 'EXECUTED', executedAt: alreadyAt,
      },
    })
    const { executeApproval } = await import('./approval-handler.js')

    const result = await executeApproval('a1')

    expect(result).toMatchObject({ outcome: 'already_executed', approvalId: 'a1', executedAt: alreadyAt })
    expect(updateMany).not.toHaveBeenCalled()
    expect(enqueueApprovalExecution).not.toHaveBeenCalled()
  })

  it('loses the race gracefully: conditional update matches 0 rows => already_executed, no double enqueue', async () => {
    const raceWinnerAt = new Date('2026-07-14T01:00:00Z')
    const { updateMany, enqueueApprovalExecution } = setup({
      // first read: still un-executed; conditional update then matches 0 rows
      findUnique: { id: 'a1', reviewId: 'r1', command: 'echo hi', status: 'PENDING', executedAt: null },
      updateManyCount: 0,
      // re-read after the lost race reflects the winner's timestamp
      secondFindUnique: { id: 'a1', reviewId: 'r1', command: 'echo hi', status: 'EXECUTED', executedAt: raceWinnerAt },
    })
    const { executeApproval } = await import('./approval-handler.js')

    const result = await executeApproval('a1')

    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(enqueueApprovalExecution).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outcome: 'already_executed', executedAt: raceWinnerAt })
  })
})
