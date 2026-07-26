import { describe, it, expect } from 'vitest';
import { computeFixCooldown, FIX_COOLDOWN_BASE_SECONDS, FIX_COOLDOWN_MAX_SECONDS } from './fix-cooldown';

// Mirrors packages/webhook/src/fix/cooldown.test.ts's coverage of the pure
// math — see this module's header comment for why the implementation is
// duplicated rather than imported across the dashboard/webhook boundary.
describe('computeFixCooldown', () => {
  // Drift guard — the other half of the pair in
  // packages/webhook/src/fix/cooldown.test.ts. Every other assertion in both
  // files is written relative to the constants, so a one-sided edit to the
  // backoff would leave both suites green while this route advertised a
  // Retry-After the queue consumer does not honour. Change these values in
  // both files, in the same commit, or not at all.
  it('pins the backoff policy shared with the webhook copy', () => {
    expect(FIX_COOLDOWN_BASE_SECONDS).toBe(300);
    expect(FIX_COOLDOWN_MAX_SECONDS).toBe(3600);
  });

  it('allows when there is no prior failure', () => {
    expect(computeFixCooldown(0, null)).toEqual({ allowed: true });
  });

  it('refuses an immediate retry right after a first failure', () => {
    const at = new Date('2026-07-21T00:00:00Z');
    const result = computeFixCooldown(1, at, at);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(FIX_COOLDOWN_BASE_SECONDS);
  });

  it('allows a retry once the base window has fully elapsed', () => {
    const at = new Date('2026-07-21T00:00:00Z');
    const now = new Date(at.getTime() + FIX_COOLDOWN_BASE_SECONDS * 1000);
    expect(computeFixCooldown(1, at, now)).toEqual({ allowed: true });
  });

  it('doubles the cooldown window across consecutive failures, capped at the max', () => {
    const at = new Date('2026-07-21T00:00:00Z');
    expect(computeFixCooldown(2, at, at).retryAfterSeconds).toBe(FIX_COOLDOWN_BASE_SECONDS * 2);
    expect(computeFixCooldown(3, at, at).retryAfterSeconds).toBe(FIX_COOLDOWN_BASE_SECONDS * 4);
    expect(computeFixCooldown(10, at, at).retryAfterSeconds).toBe(FIX_COOLDOWN_MAX_SECONDS);
  });
});
