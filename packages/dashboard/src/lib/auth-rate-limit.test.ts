import { describe, it, expect } from 'vitest';
import { createSlidingWindowLimiter, createAuthGuard } from './auth-rate-limit';

const T0 = 1_000_000;

describe('createSlidingWindowLimiter', () => {
  it('allows up to the limit, then blocks with an honest retry-after', () => {
    const limiter = createSlidingWindowLimiter({ limit: 3, windowMs: 60_000 });
    expect(limiter.check('k', T0).allowed).toBe(true);
    expect(limiter.check('k', T0 + 1000).allowed).toBe(true);
    expect(limiter.check('k', T0 + 2000).allowed).toBe(true);
    // Oldest attempt at T0 leaves the window at T0+60s → 57s remain.
    expect(limiter.check('k', T0 + 3000)).toEqual({ allowed: false, retryAfterSeconds: 57 });
  });

  it('slides: attempts outside the window no longer count', () => {
    const limiter = createSlidingWindowLimiter({ limit: 2, windowMs: 60_000 });
    limiter.check('k', T0);
    limiter.check('k', T0 + 1000);
    expect(limiter.check('k', T0 + 2000).allowed).toBe(false);
    expect(limiter.check('k', T0 + 61_000).allowed).toBe(true);
  });

  it('isolates keys', () => {
    const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.check('a', T0).allowed).toBe(true);
    expect(limiter.check('a', T0).allowed).toBe(false);
    expect(limiter.check('b', T0).allowed).toBe(true);
  });

  it('caps tracked keys (oldest evicted, memory bounded)', () => {
    const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    limiter.check('a', T0);
    limiter.check('b', T0);
    limiter.check('c', T0); // evicts 'a'
    expect(limiter.check('a', T0).allowed).toBe(true); // fresh again — evicted
  });
});

describe('createAuthGuard', () => {
  it('limits login per-email across DIFFERENT IPs (5/min)', () => {
    const guard = createAuthGuard();
    for (let i = 0; i < 5; i++) {
      expect(guard.check('login', `9.9.9.${i}`, 'a@x.com', T0 + i).limited).toBe(false);
    }
    const blocked = guard.check('login', '9.9.9.99', 'a@x.com', T0 + 10);
    expect(blocked.limited).toBe(true);
    if (blocked.limited) expect(blocked.error).toMatch(/too many/i);
  });

  it('limits login per-IP across DIFFERENT emails (10/min)', () => {
    const guard = createAuthGuard();
    for (let i = 0; i < 10; i++) {
      expect(guard.check('login', '9.9.9.9', `u${i}@x.com`, T0 + i).limited).toBe(false);
    }
    expect(guard.check('login', '9.9.9.9', 'fresh@x.com', T0 + 20).limited).toBe(true);
  });

  it('treats email case- and whitespace-insensitively for the per-email key', () => {
    const guard = createAuthGuard();
    for (let i = 0; i < 5; i++) guard.check('login', `9.9.9.${i}`, ' A@X.com ', T0 + i);
    expect(guard.check('login', '9.9.9.99', 'a@x.com', T0 + 10).limited).toBe(true);
  });

  it('still limits per-email when the IP is unknown', () => {
    const guard = createAuthGuard();
    for (let i = 0; i < 5; i++) guard.check('login', null, 'a@x.com', T0 + i);
    expect(guard.check('login', null, 'a@x.com', T0 + 10).limited).toBe(true);
  });

  it('signup is stricter per-email (3/min) and independent of login counters', () => {
    const guard = createAuthGuard();
    for (let i = 0; i < 3; i++) {
      expect(guard.check('signup', `9.9.9.${i}`, 'a@x.com', T0 + i).limited).toBe(false);
    }
    expect(guard.check('signup', '9.9.9.99', 'a@x.com', T0 + 10).limited).toBe(true);
    // login for the same email is untouched by signup attempts
    expect(guard.check('login', '9.9.9.99', 'a@x.com', T0 + 10).limited).toBe(false);
  });

  it('the limited error names the wait honestly', () => {
    const guard = createAuthGuard();
    for (let i = 0; i < 5; i++) guard.check('login', null, 'a@x.com', T0);
    const blocked = guard.check('login', null, 'a@x.com', T0);
    expect(blocked.limited).toBe(true);
    if (blocked.limited) expect(blocked.error).toMatch(/\b60s\b/);
  });
});
