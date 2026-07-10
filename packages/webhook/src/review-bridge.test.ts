import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const MOCK_RESULT = {
  pr_context: { repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] },
  file_reviews: [],
  overall_summary: 'No issues.',
  risk_level: 'low',
  total_comments: 0,
}

function makeProc(stdout: string, exitCode: number) {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = { write: vi.fn(), end: vi.fn() }
  setTimeout(() => {
    proc.stdout.emit('data', Buffer.from(stdout))
    proc.emit('close', exitCode)
  }, 0)
  return proc
}

describe('runReviewPipeline', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns parsed ReviewResult on success', async () => {
    vi.doMock('node:child_process', () => ({
      spawn: vi.fn(() => makeProc(JSON.stringify(MOCK_RESULT), 0)),
    }))
    const { runReviewPipeline } = await import('./review-bridge.js')
    const result = await runReviewPipeline({
      repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [],
    })
    expect(result.risk_level).toBe('low')
  })

  it('throws when Python process exits non-zero', async () => {
    vi.doMock('node:child_process', () => ({
      spawn: vi.fn(() => makeProc('', 1)),
    }))
    const { runReviewPipeline } = await import('./review-bridge.js')
    await expect(
      runReviewPipeline({ repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] })
    ).rejects.toThrow('exited with code 1')
  })

  it('rejects with timeout error when process takes too long', async () => {
    vi.useFakeTimers()
    vi.doMock('node:child_process', () => ({
      spawn: vi.fn(() => {
        const proc = new EventEmitter() as any
        proc.stdout = new EventEmitter()
        proc.stderr = new EventEmitter()
        proc.stdin = { write: vi.fn(), end: vi.fn() }
        proc.kill = vi.fn()
        // Never emit 'close' — simulates a hung process
        return proc
      }),
    }))
    const { runReviewPipeline } = await import('./review-bridge.js')
    const promise = runReviewPipeline({ repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] })
    vi.advanceTimersByTime(120_001)
    await expect(promise).rejects.toThrow('timed out')
    vi.useRealTimers()
  })
})
