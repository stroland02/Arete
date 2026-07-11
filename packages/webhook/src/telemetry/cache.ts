import type { TelemetrySnapshot } from '../types.js'

// In-process cache, not Redis-backed — acceptable for v1 given the worker
// runs as a small number of processes with bounded concurrency (see
// queue.ts's REVIEW_QUEUE_CONCURRENCY); a shared cross-process cache is a
// reasonable future upgrade once telemetry volume justifies it. Purpose is
// primarily to protect the customer's own provider API quota by
// deduplicating fetches across nearby-in-time reviews for the same PR/repo,
// not to be a durable store.

const TTL_MS = 15 * 60 * 1000

interface CacheEntry {
  snapshot: TelemetrySnapshot
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(installationId: string, provider: string, sourceRef: string): string {
  return `${installationId}:${provider}:${sourceRef}`
}

export function getCachedTelemetry(
  installationId: string,
  provider: string,
  sourceRef: string
): TelemetrySnapshot | null {
  const entry = cache.get(cacheKey(installationId, provider, sourceRef))
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) {
    cache.delete(cacheKey(installationId, provider, sourceRef))
    return null
  }
  return entry.snapshot
}

export function setCachedTelemetry(
  installationId: string,
  provider: string,
  sourceRef: string,
  snapshot: TelemetrySnapshot
): void {
  cache.set(cacheKey(installationId, provider, sourceRef), {
    snapshot,
    expiresAt: Date.now() + TTL_MS,
  })
}
