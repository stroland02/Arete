import { describe, it, expect } from 'vitest'
import {
  computeFixCooldown,
  checkFixCooldown,
  FIX_COOLDOWN_BASE_SECONDS,
  FIX_COOLDOWN_MAX_SECONDS,
} from './cooldown.js'

describe('computeFixCooldown', () => {
  // Drift guard. This policy is deliberately duplicated in
  // packages/dashboard/src/lib/fix-cooldown.ts (the two packages are separate
  // deployables and neither exports a library surface to the other), so the
  // ONLY thing keeping the two enforcement points in agreement is that both
  // pin the same literals. Every other assertion here is written relative to
  // the constants, so without this test a one-sided edit would leave both
  // suites green while the dashboard advertised a Retry-After the queue
  // consumer does not honour. If you change these values, change them in the
  // sibling file and its test in the same commit.
  it('pins the backoff policy shared with the dashboard copy', () => {
    expect(FIX_COOLDOWN_BASE_SECONDS).toBe(300)
    expect(FIX_COOLDOWN_MAX_SECONDS).toBe(3600)
  })

  it('allows when there is no prior failure (count 0, no timestamp)', () => {
    expect(computeFixCooldown(0, null)).toEqual({ allowed: true })
  })

  it('refuses an immediate retry right after a first failure', () => {
    const at = new Date('2026-07-21T00:00:00Z')
    const result = computeFixCooldown(1, at, at)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBe(FIX_COOLDOWN_BASE_SECONDS)
  })

  it('still refuses one second before the base window elapses', () => {
    const at = new Date('2026-07-21T00:00:00Z')
    const now = new Date(at.getTime() + (FIX_COOLDOWN_BASE_SECONDS - 1) * 1000)
    const result = computeFixCooldown(1, at, now)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBe(1)
  })

  it('allows a retry once the base window has fully elapsed', () => {
    const at = new Date('2026-07-21T00:00:00Z')
    const now = new Date(at.getTime() + FIX_COOLDOWN_BASE_SECONDS * 1000)
    expect(computeFixCooldown(1, at, now)).toEqual({ allowed: true })
  })

  it('doubles the cooldown window across consecutive failures', () => {
    const at = new Date('2026-07-21T00:00:00Z')
    expect(computeFixCooldown(2, at, at).retryAfterSeconds).toBe(FIX_COOLDOWN_BASE_SECONDS * 2)
    expect(computeFixCooldown(3, at, at).retryAfterSeconds).toBe(FIX_COOLDOWN_BASE_SECONDS * 4)
    expect(computeFixCooldown(4, at, at).retryAfterSeconds).toBe(FIX_COOLDOWN_BASE_SECONDS * 8)
  })

  it('caps the window at FIX_COOLDOWN_MAX_SECONDS regardless of how many failures accrue', () => {
    const at = new Date('2026-07-21T00:00:00Z')
    // Uncapped, failure 5 would be 5min * 2^4 = 4800s > the 3600s (1hr) cap.
    expect(computeFixCooldown(5, at, at).retryAfterSeconds).toBe(FIX_COOLDOWN_MAX_SECONDS)
    expect(computeFixCooldown(10, at, at).retryAfterSeconds).toBe(FIX_COOLDOWN_MAX_SECONDS)
  })

  it('fails open when a failure count is present but the timestamp is missing (data inconsistency)', () => {
    expect(computeFixCooldown(3, null)).toEqual({ allowed: true })
  })
})

describe('checkFixCooldown', () => {
  it('reads the WorkItem failure bookkeeping and applies computeFixCooldown', async () => {
    const at = new Date()
    const deps = { prisma: { workItem: { findUnique: async () => ({ fixFailureCount: 1, fixFailureAt: at }) } } }
    const result = await checkFixCooldown('wi-1', deps)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('allows when the work item cannot be found — nothing to guard here', async () => {
    const deps = { prisma: { workItem: { findUnique: async () => null } } }
    expect(await checkFixCooldown('missing', deps)).toEqual({ allowed: true })
  })

  it('allows when the work item has never failed', async () => {
    const deps = { prisma: { workItem: { findUnique: async () => ({ fixFailureCount: 0, fixFailureAt: null }) } } }
    expect(await checkFixCooldown('wi-1', deps)).toEqual({ allowed: true })
  })
})
