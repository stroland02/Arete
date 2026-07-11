/**
 * Staleness policy for the user -> authorized-installations mapping cached
 * in the session JWT.
 *
 * Tradeoff: re-deriving on every request (fresh GitHub API + DB call each
 * page load) is always correct but slow and rate-limit-hungry. Caching
 * forever in the JWT is fast but goes stale until the user re-logs-in (e.g.
 * they install the GitHub App on a new org, or lose admin rights, and the
 * dashboard doesn't notice until the JWT expires or they sign out/in).
 *
 * This is the middle ground the task brief calls out: a short TTL. The JWT
 * callback re-derives the mapping whenever it's missing or older than
 * INSTALLATION_CACHE_TTL_MS, otherwise reuses the cached value.
 */
export const INSTALLATION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function shouldRefreshInstallations(
  fetchedAt: number | undefined,
  now: number,
  ttlMs: number = INSTALLATION_CACHE_TTL_MS
): boolean {
  if (fetchedAt === undefined) return true;
  return now - fetchedAt > ttlMs;
}
