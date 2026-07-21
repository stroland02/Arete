// Pure cooldown math for the dashboard's fix-retry guard (Phase 2 Task 6).
//
// This DUPLICATES packages/webhook/src/fix/cooldown.ts's computeFixCooldown
// verbatim rather than importing it. That is a deliberate call, not an
// oversight: the dashboard and webhook are genuinely separate deployables.
// The dashboard's package.json dependencies are @arete/db, @arete/orchestration,
// and @arete/topology only — it talks to the webhook service over HTTP
// (internalAuthHeaders + WEBHOOK_SERVICE_URL, see work-items/[id]/fix/route.ts),
// never by importing webhook's TypeScript sources. The webhook package itself
// is `"private": true` with no "main"/"types"/"exports" field — it isn't set
// up to be consumed as a library at all, by any package. Adding a new
// cross-service source dependency for ~15 lines of pure arithmetic would trade
// a one-time duplication for a permanent build/version coupling between two
// independently deployed services, which is a worse trade. (An alternative
// considered and rejected: hosting this in @arete/db, which both packages
// already depend on — but that package's established contract is "re-export
// the generated Prisma client" only, with zero hand-written business logic;
// this would be the first such thing there.)
//
// Both copies are unit-tested independently (this file's .test.ts, and
// cooldown.test.ts on the webhook side). If the backoff shape ever changes,
// BOTH must change together — that obligation is recorded here and there.
export interface FixCooldownResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export const FIX_COOLDOWN_BASE_SECONDS = 5 * 60; // 5 minutes
export const FIX_COOLDOWN_MAX_SECONDS = 60 * 60; // 1 hour

export function computeFixCooldown(
  failureCount: number,
  lastFailureAt: Date | null,
  now: Date = new Date(),
): FixCooldownResult {
  if (failureCount <= 0 || !lastFailureAt) return { allowed: true };

  const windowSeconds = Math.min(
    FIX_COOLDOWN_BASE_SECONDS * 2 ** (failureCount - 1),
    FIX_COOLDOWN_MAX_SECONDS,
  );
  const elapsedSeconds = (now.getTime() - lastFailureAt.getTime()) / 1000;
  if (elapsedSeconds >= windowSeconds) return { allowed: true };

  return { allowed: false, retryAfterSeconds: Math.ceil(windowSeconds - elapsedSeconds) };
}
