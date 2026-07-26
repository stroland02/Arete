// Tenant-scoped management core for outbound webhook endpoints.
//
// WHY THIS EXISTS. The management API (POST/GET /api/webhooks/endpoints) was
// pulled from server.ts and left unmounted, for a real vulnerability: it
// trusted a client-supplied installationId with NO authentication, so an
// anonymous caller could register a webhook for — or list the endpoints of —
// any tenant, and listing returned each endpoint's `whsec_` signing secret.
// With that secret an attacker can forge payloads that pass a receiver's
// signature check. So the surface stayed dark, and with it every "send Kuma's
// findings to Slack/Linear/PagerDuty" feature that needs somewhere to send to.
//
// This module is the part that was missing: the tenant-scoped core. It does NOT
// authenticate — it cannot, and must not try. It takes an installationId its
// caller has already PROVEN belongs to the requester, exactly like
// memory-write.ts's contract. The proving happens in the dashboard, the only
// service with a session (Auth.js), which derives the id from that session and
// never from the request body. The routes in front of this live under
// `/internal`, which server.ts guards wholesale with requireInternalToken, so
// the only caller that can reach them holds a signed internal token.
//
// THREE RULES THIS MODULE ENFORCES, each closing part of the original defect:
//
//  1. The secret leaves exactly once. `listTenantEndpoints` maps every row
//     through `toPublicEndpoint` (store.ts), which strips `secret`. Only
//     `createTenantEndpoint` ever returns it — at the moment of creation, to
//     the tenant who just created it, and never again. That is the "write-once
//     semantics at the API layer" the schema comment specifies. A reveal/rotate
//     endpoint is deliberately absent: there is no read path to abuse.
//
//  2. Toggling is OWNERSHIP-CHECKED. `WebhookStore.setEnabled(id, enabled)`
//     takes an id and NOTHING ELSE — it is not tenant-scoped and will happily
//     disable any row in the table. Handing a raw endpoint id to it from an API
//     is a cross-tenant write. `setTenantEndpointEnabled` therefore resolves the
//     id through the caller's OWN endpoint list first, and an id outside that
//     list is `not_found` — identical to an id that never existed, so a probe
//     cannot distinguish "not yours" from "doesn't exist" (Global Constraint 4,
//     the same posture memory-write.ts takes).
//
//  3. The URL is SSRF-checked at create time by the same guard the delivery
//     path uses (`assertPublicWebhookUrl`, @arete/net-guard) — not a second copy
//     of the rules. Delivery re-checks before every send (deliver.ts's
//     webhookFetch), which is the authoritative control; validating here means a
//     tenant is told immediately rather than silently never receiving anything.

import { assertPublicWebhookUrl } from '@arete/net-guard'
import { toPublicEndpoint, type PublicEndpoint, type WebhookStore } from './store.js'
import type { WebhookEvent } from './payload.js'

/** The only events an endpoint may subscribe to (payload.ts's WebhookEvent).
 *  Mirrors the schema's "a subset of [review.created, review.updated]". */
const ALLOWED_EVENTS: readonly string[] = [
  'review.created',
  'review.updated',
] satisfies readonly WebhookEvent[]

export type ManagementReason = 'invalid_url' | 'invalid_events' | 'not_found' | 'internal_error'

export type ManagementResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ManagementReason; detail?: string }

/** Just the slice of the store this module touches, so tests drive it with the
 *  in-memory implementation and production passes PrismaWebhookStore. */
export type ManagementStore = Pick<WebhookStore, 'createEndpoint' | 'listEndpoints' | 'setEnabled'>

export interface ManagementDeps {
  store: ManagementStore
  /** Overridable ONLY so tests can drive the rejection branch without real DNS;
   *  production uses the same guard the delivery path does. */
  assertUrl?: (url: string) => Promise<unknown>
}

/**
 * Every endpoint of ONE installation, secrets stripped. `installationId` must
 * already be proven to belong to the caller.
 */
export async function listTenantEndpoints(
  installationId: string,
  deps: ManagementDeps,
): Promise<ManagementResult<PublicEndpoint[]>> {
  try {
    const rows = await deps.store.listEndpoints(installationId)
    return { ok: true, data: rows.map(toPublicEndpoint) }
  } catch {
    return { ok: false, reason: 'internal_error' }
  }
}

export interface CreateTenantEndpointInput {
  installationId: string
  url: string
  events: string[]
}

/**
 * Registers an endpoint and returns its signing secret — THE ONLY TIME the
 * secret is ever returned. The caller must surface it once and never store it
 * anywhere it can be read back.
 */
export async function createTenantEndpoint(
  input: CreateTenantEndpointInput,
  deps: ManagementDeps,
): Promise<ManagementResult<{ endpoint: PublicEndpoint; secret: string }>> {
  const events = Array.isArray(input.events) ? input.events : []
  if (events.length === 0 || !events.every((e) => ALLOWED_EVENTS.includes(e))) {
    return {
      ok: false,
      reason: 'invalid_events',
      detail: `events must be a non-empty subset of ${ALLOWED_EVENTS.join(', ')}`,
    }
  }

  if (typeof input.url !== 'string' || !input.url.trim()) {
    return { ok: false, reason: 'invalid_url', detail: 'url is required' }
  }

  // SSRF gate, same guard as delivery. A URL that resolves to a private or
  // loopback address is refused HERE so the tenant finds out now, rather than
  // registering an endpoint that silently never receives anything.
  const assertUrl = deps.assertUrl ?? assertPublicWebhookUrl
  try {
    await assertUrl(input.url)
  } catch (err) {
    return {
      ok: false,
      reason: 'invalid_url',
      detail: err instanceof Error ? err.message : 'destination is not a public http(s) URL',
    }
  }

  try {
    const created = await deps.store.createEndpoint({
      installationId: input.installationId,
      url: input.url,
      events,
    })
    return { ok: true, data: { endpoint: toPublicEndpoint(created), secret: created.secret } }
  } catch {
    return { ok: false, reason: 'internal_error' }
  }
}

export interface SetEnabledInput {
  installationId: string
  id: string
  enabled: boolean
}

/**
 * Enables or disables ONE endpoint the caller owns. See rule 2 in the module
 * header: `store.setEnabled` is NOT tenant-scoped, so ownership is resolved
 * here first and an id outside the caller's own list is `not_found`.
 */
export async function setTenantEndpointEnabled(
  input: SetEnabledInput,
  deps: ManagementDeps,
): Promise<ManagementResult<PublicEndpoint>> {
  try {
    const owned = await deps.store.listEndpoints(input.installationId)
    const match = owned.find((e) => e.id === input.id)
    // Indistinguishable from a genuinely missing id — never reveal that the row
    // exists under another tenant.
    if (!match) return { ok: false, reason: 'not_found' }

    await deps.store.setEnabled(input.id, input.enabled)
    return { ok: true, data: { ...toPublicEndpoint(match), enabled: input.enabled } }
  } catch {
    return { ok: false, reason: 'internal_error' }
  }
}
