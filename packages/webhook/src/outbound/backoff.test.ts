import { describe, expect, test } from 'vitest'
import { MAX_ATTEMPTS, nextRetryDelayMs } from './backoff.js'

// SuperLog's delivery curve, adopted verbatim: 8 attempts total, the first
// immediate, then 30s → 1m → 2m → 5m → 15m → 1h → 6h between retries (~8h span).

describe('nextRetryDelayMs', () => {
  test('exposes an 8-attempt ceiling', () => {
    expect(MAX_ATTEMPTS).toBe(8)
  })

  test('follows the SuperLog backoff curve after each failed attempt', () => {
    // attemptsMade = how many deliveries have already failed
    expect(nextRetryDelayMs(1)).toBe(30_000) //   30s before attempt 2
    expect(nextRetryDelayMs(2)).toBe(60_000) //    1m before attempt 3
    expect(nextRetryDelayMs(3)).toBe(120_000) //   2m before attempt 4
    expect(nextRetryDelayMs(4)).toBe(300_000) //   5m before attempt 5
    expect(nextRetryDelayMs(5)).toBe(900_000) //  15m before attempt 6
    expect(nextRetryDelayMs(6)).toBe(3_600_000) // 1h before attempt 7
    expect(nextRetryDelayMs(7)).toBe(21_600_000) //6h before attempt 8
  })

  test('returns null once all 8 attempts are exhausted', () => {
    expect(nextRetryDelayMs(8)).toBeNull()
    expect(nextRetryDelayMs(9)).toBeNull()
  })

  test('treats the initial send (no attempts yet) as immediate', () => {
    expect(nextRetryDelayMs(0)).toBe(0)
  })
})
