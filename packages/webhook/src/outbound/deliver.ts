import { webhookFetch } from '@arete/net-guard'
import { nextRetryDelayMs } from './backoff.js'
import type { WebhookPayload } from './payload.js'
import { signWebhook } from './signature.js'

// Performs a single delivery attempt for one webhook and reports the outcome.
// This is the composition layer — it owns NONE of the primitives:
//   • transport + SSRF hardening + IP pinning → @arete/net-guard webhookFetch
//   • signing                                 → ./signature
//   • retry timing                            → ./backoff
// The caller (worker) persists the outcome onto the WebhookDelivery row and
// re-schedules using `nextAttemptMs`.

const DEFAULT_TIMEOUT_MS = 10_000
const USER_AGENT = 'Arete-Webhooks/1.0'

export interface DeliverableEndpoint {
  id: string
  url: string
  /** whsec_-prefixed HMAC secret. Never logged or echoed. */
  secret: string
}

export interface DeliveryOutcome {
  status: 'delivered' | 'pending' | 'failed'
  /** HTTP status of this attempt, or null if the request got no response. */
  code: number | null
  /** Short error string for a failed attempt; never contains the secret. */
  error: string | null
  /** Total attempts made including this one. */
  attempts: number
  /** ms until the next retry is due, or null when delivered / exhausted. */
  nextAttemptMs: number | null
}

export interface DeliverOptions {
  /** Attempts already made before this one (default 0 → this is attempt 1). */
  attemptsMade?: number
  timeoutMs?: number
  /** Unix seconds to stamp into the signature; defaults to now. Injectable for tests. */
  nowSec?: number
}

/** Deliver one signed webhook attempt. Never throws for a delivery failure —
 *  a non-2xx response or a transport/SSRF error is reported as a retryable (or
 *  exhausted) outcome so the worker can persist it and move on. */
export async function deliverWebhook(
  endpoint: DeliverableEndpoint,
  payload: WebhookPayload,
  deliveryId: string,
  options: DeliverOptions = {},
): Promise<DeliveryOutcome> {
  const attempts = (options.attemptsMade ?? 0) + 1
  const rawBody = JSON.stringify(payload)
  const timestampSec = options.nowSec ?? Math.floor(Date.now() / 1000)
  const signature = signWebhook(endpoint.secret, rawBody, timestampSec)

  const failed = (code: number | null, error: string | null): DeliveryOutcome => {
    const delay = nextRetryDelayMs(attempts)
    return {
      status: delay === null ? 'failed' : 'pending',
      code,
      error,
      attempts,
      nextAttemptMs: delay,
    }
  }

  try {
    const res = await webhookFetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        'arete-event': payload.event,
        'arete-delivery': deliveryId,
        'arete-signature': signature,
      },
      body: rawBody,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })

    if (res.status >= 200 && res.status < 300) {
      return { status: 'delivered', code: res.status, error: null, attempts, nextAttemptMs: null }
    }
    // Non-2xx (incl. a 3xx, since redirects are never followed) → retryable.
    return failed(res.status, `non-2xx response: ${res.status}`)
  } catch (err) {
    // Transport error, timeout, or an SSRF-guard rejection. Report, don't throw.
    return failed(null, err instanceof Error ? err.message : String(err))
  }
}
