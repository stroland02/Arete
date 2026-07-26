import { describe, it, expect, vi, afterEach } from 'vitest'
import { startOutboundRetryWorker } from './retry-worker.js'

// Regression guard for a real defect: `startRetryWorker` existed, was correct,
// and was never called by anything. Failed deliveries recorded a `nextAttempt`
// and were then abandoned — silent data loss that no test caught, because every
// existing test covered the per-tick logic rather than the wiring.
//
// These tests pin the wiring itself: that a starter exists which the worker
// entrypoint can call with no arguments, and that its poll rate is operable.

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.OUTBOUND_RETRY_INTERVAL_MS
})

describe('startOutboundRetryWorker', () => {
  it('returns a stoppable handle so the worker entrypoint can wire it in', () => {
    const handle = startOutboundRetryWorker()
    expect(handle).not.toBeNull()
    expect(typeof handle.stop).toBe('function')
    handle.stop()
  })

  it('does not keep the process alive on its own', () => {
    // The retry loop must never be the reason the worker refuses to exit.
    const unref = vi.fn()
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockReturnValue({ unref } as unknown as NodeJS.Timeout)

    const handle = startOutboundRetryWorker()

    expect(setIntervalSpy).toHaveBeenCalled()
    expect(unref).toHaveBeenCalled()
    handle.stop()
  })

  it('honours OUTBOUND_RETRY_INTERVAL_MS so the poll rate is operable', () => {
    process.env.OUTBOUND_RETRY_INTERVAL_MS = '5000'
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockReturnValue({ unref: vi.fn() } as unknown as NodeJS.Timeout)

    const handle = startOutboundRetryWorker()

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
    handle.stop()
  })

  it('ignores a non-numeric interval rather than polling on NaN', () => {
    process.env.OUTBOUND_RETRY_INTERVAL_MS = 'not-a-number'
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockReturnValue({ unref: vi.fn() } as unknown as NodeJS.Timeout)

    const handle = startOutboundRetryWorker()

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000)
    handle.stop()
  })
})
