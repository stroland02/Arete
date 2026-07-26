// Delivery retry policy, adopted verbatim from SuperLog: 8 attempts total, the
// first fired immediately, then backing off 30s → 1m → 2m → 5m → 15m → 1h → 6h
// (~8h total span) before giving up and marking the delivery failed. Reusing a
// proven curve rather than inventing one — long enough to ride out a multi-hour
// receiver outage, bounded so a dead endpoint can't retry forever.

export const MAX_ATTEMPTS = 8

// Gap before the Nth retry, indexed by attempts already made (1 → gap before
// attempt 2, …, 7 → gap before attempt 8). Seven gaps for eight attempts.
const RETRY_GAPS_MS: readonly number[] = [
  30_000, // 30s
  60_000, // 1m
  120_000, // 2m
  300_000, // 5m
  900_000, // 15m
  3_600_000, // 1h
  21_600_000, // 6h
]

/** Delay in ms before the next delivery attempt, given how many attempts have
 *  already failed. Returns 0 for the initial send (no prior attempts) and null
 *  once all MAX_ATTEMPTS attempts are exhausted. */
export function nextRetryDelayMs(attemptsMade: number): number | null {
  if (attemptsMade <= 0) return 0
  if (attemptsMade >= MAX_ATTEMPTS) return null
  return RETRY_GAPS_MS[attemptsMade - 1] ?? null
}
