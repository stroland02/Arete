// Rate limiting for the credential auth surface (login / signup server
// actions) — pure, in-memory, per-process. Two keys per attempt: the caller's
// IP and the target email, so neither a single machine hammering many
// accounts nor many machines hammering one account gets through. Sliding
// window; the "try again" copy is honest about the wait. Normal-flow client
// copy is untouched — only a new limited-state message is added.

export interface LimiterOptions {
  limit: number;
  windowMs: number;
  /** Bound on tracked keys so an attacker cycling keys can't grow memory. */
  maxKeys?: number;
}

export type LimiterCheck =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/** Sliding-window counter. `check` records the attempt when allowed. */
export function createSlidingWindowLimiter({ limit, windowMs, maxKeys = 10_000 }: LimiterOptions) {
  const attempts = new Map<string, number[]>();

  return {
    check(key: string, now: number = Date.now()): LimiterCheck {
      const cutoff = now - windowMs;
      const kept = (attempts.get(key) ?? []).filter((t) => t > cutoff);
      if (kept.length >= limit) {
        attempts.set(key, kept);
        return { allowed: false, retryAfterSeconds: Math.ceil((kept[0] + windowMs - now) / 1000) };
      }
      kept.push(now);
      // Re-insert so Map order approximates recency; evict the stalest key
      // when over the cap (bounded memory beats perfect fairness here).
      attempts.delete(key);
      attempts.set(key, kept);
      if (attempts.size > maxKeys) {
        const oldest = attempts.keys().next().value;
        if (oldest !== undefined) attempts.delete(oldest);
      }
      return { allowed: true };
    },
  };
}

export type AuthAttemptKind = 'login' | 'signup';

export type AuthGuardResult = { limited: false } | { limited: true; error: string };

const WINDOW_MS = 60_000;
const LIMITS: Record<AuthAttemptKind, { perIp: number; perEmail: number }> = {
  login: { perIp: 10, perEmail: 5 },
  signup: { perIp: 5, perEmail: 3 },
};

/** Per-kind, per-dimension limiters. Separate instances per kind so signup
 *  pressure never locks a legitimate login out (and vice versa). */
export function createAuthGuard() {
  const limiters = {
    login: {
      ip: createSlidingWindowLimiter({ limit: LIMITS.login.perIp, windowMs: WINDOW_MS }),
      email: createSlidingWindowLimiter({ limit: LIMITS.login.perEmail, windowMs: WINDOW_MS }),
    },
    signup: {
      ip: createSlidingWindowLimiter({ limit: LIMITS.signup.perIp, windowMs: WINDOW_MS }),
      email: createSlidingWindowLimiter({ limit: LIMITS.signup.perEmail, windowMs: WINDOW_MS }),
    },
  };

  return {
    check(kind: AuthAttemptKind, ip: string | null, email: string, now: number = Date.now()): AuthGuardResult {
      const results: LimiterCheck[] = [];
      if (ip) results.push(limiters[kind].ip.check(`ip:${ip}`, now));
      results.push(limiters[kind].email.check(`email:${email.trim().toLowerCase()}`, now));
      const blocked = results.find((r): r is Extract<LimiterCheck, { allowed: false }> => !r.allowed);
      if (!blocked) return { limited: false };
      return {
        limited: true,
        error: `Too many attempts. Try again in ${blocked.retryAfterSeconds}s.`,
      };
    },
  };
}

/** Process-wide guard used by the login/signup actions. */
export const authGuard = createAuthGuard();
