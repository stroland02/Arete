import { deliverWebhook } from './deliver.js'
import {
  renderWebhookPayload,
  type WebhookChange,
  type WebhookEvent,
  type WebhookReviewSummary,
} from './payload.js'
import type { StoredDelivery, WebhookStore } from './store.js'

// Fan a single review event out to every enabled endpoint of the installation
// that subscribes to it: render the payload once, record a pending delivery
// row, attempt delivery, then settle the row with the outcome. This is the
// entry point the emission sites (review-bridge persist, approval-handler)
// call — one function, so those sites stay a one-liner.

export interface DispatchInput {
  installationId: string
  event: WebhookEvent
  review: WebhookReviewSummary
  occurredAtIso: string
  change?: WebhookChange
}

/** Deliver `input.event` to all matching endpoints. Returns the settled
 *  delivery rows (one per endpoint). Each delivery is independent — one
 *  endpoint failing never blocks another. */
export async function dispatchEvent(
  store: WebhookStore,
  input: DispatchInput,
): Promise<StoredDelivery[]> {
  const endpoints = await store.endpointsFor(input.installationId, input.event)
  if (endpoints.length === 0) return []

  const payload = renderWebhookPayload({
    event: input.event,
    review: input.review,
    occurredAtIso: input.occurredAtIso,
    ...(input.change ? { change: input.change } : {}),
  })

  return Promise.all(
    endpoints.map(async (ep) => {
      // Record first so the delivery id (== Arete-Delivery header) is stable and
      // persisted before we attempt — a crash mid-send still leaves a row.
      const row = await store.recordDelivery({
        endpointId: ep.id,
        event: input.event,
        payload,
      })
      const outcome = await deliverWebhook(
        { id: ep.id, url: ep.url, secret: ep.secret },
        payload,
        row.id,
      )
      return store.settleDelivery(row.id, outcome)
    }),
  )
}
