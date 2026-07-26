import { dispatchEvent } from './dispatch.js'
import type { StoredDelivery, WebhookStore } from './store.js'

// Emission helper: the one call site persistence/handlers use to fire an
// outbound webhook for a domain event. Keeps the mapping (domain review →
// webhook payload shape) in one tested place so the call sites stay one-liners.

export interface ReviewCreatedEmission {
  installationId: string
  reviewId: string
  prNumber: number
  repositoryFullName: string
  riskLevel: string
  /** Defaults to now; injectable for deterministic tests. */
  occurredAtIso?: string
}

/** Fire a `review.created` webhook for a freshly-persisted review. Returns the
 *  settled delivery rows (empty if the installation has no subscribed endpoint).
 *  Never throws for "no endpoints" — callers treat emission as non-fatal. */
export async function emitReviewCreated(
  store: WebhookStore,
  e: ReviewCreatedEmission,
): Promise<StoredDelivery[]> {
  return dispatchEvent(store, {
    installationId: e.installationId,
    event: 'review.created',
    review: {
      id: e.reviewId,
      prNumber: e.prNumber,
      repositoryFullName: e.repositoryFullName,
      riskLevel: e.riskLevel,
    },
    occurredAtIso: e.occurredAtIso ?? new Date().toISOString(),
  })
}
