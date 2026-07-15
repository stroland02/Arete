import { randomBytes, randomUUID } from 'node:crypto'
import type { DeliveryOutcome } from './deliver.js'

// Persistence contract for outbound webhooks, kept behind an interface so the
// delivery/dispatch logic can be driven end-to-end in tests with the in-memory
// implementation, while production uses the Prisma-backed one (see
// prisma-store.ts / the runbook — same interface, WebhookEndpoint/
// WebhookDelivery tables added in migration 20260715120000_add_webhook_endpoints).

export interface StoredEndpoint {
  id: string
  installationId: string
  url: string
  /** whsec_-prefixed HMAC secret. Only ever leaves the store via createEndpoint. */
  secret: string
  events: string[]
  enabled: boolean
}

/** An endpoint safe to return from an API: the secret is stripped. */
export type PublicEndpoint = Omit<StoredEndpoint, 'secret'>

export interface StoredDelivery {
  id: string
  endpointId: string
  event: string
  payload: unknown
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  lastCode: number | null
  lastError: string | null
  nextAttempt: Date | null
}

export interface CreateEndpointInput {
  installationId: string
  url: string
  events: string[]
}

export interface RecordDeliveryInput {
  endpointId: string
  event: string
  payload: unknown
}

export interface WebhookStore {
  createEndpoint(input: CreateEndpointInput): Promise<StoredEndpoint>
  /** All endpoints of an installation (enabled or not) — for the management API. */
  listEndpoints(installationId: string): Promise<StoredEndpoint[]>
  endpointsFor(installationId: string, event: string): Promise<StoredEndpoint[]>
  setEnabled(id: string, enabled: boolean): Promise<void>
  recordDelivery(input: RecordDeliveryInput): Promise<StoredDelivery>
  settleDelivery(id: string, outcome: DeliveryOutcome): Promise<StoredDelivery>
}

/** A cryptographically-random signing secret. base64url of 24 bytes ≈ 192 bits. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`
}

/** Strip the secret before an endpoint crosses an API boundary. */
export function toPublicEndpoint(endpoint: StoredEndpoint): PublicEndpoint {
  const { secret: _secret, ...pub } = endpoint
  return pub
}

/** Translate a delivery attempt outcome into row fields. `nextAttemptMs` is
 *  resolved to an absolute due-time here (the store owns "when"). */
function applyOutcome(row: StoredDelivery, outcome: DeliveryOutcome): StoredDelivery {
  row.status = outcome.status
  row.attempts = outcome.attempts
  row.lastCode = outcome.code
  row.lastError = outcome.error
  row.nextAttempt =
    outcome.nextAttemptMs === null ? null : new Date(Date.now() + outcome.nextAttemptMs)
  return row
}

/** In-memory WebhookStore for tests and the end-to-end drive. Not for
 *  production (no durability) — the Prisma-backed store is the real one. */
export class InMemoryWebhookStore implements WebhookStore {
  private readonly endpoints = new Map<string, StoredEndpoint>()
  private readonly deliveries = new Map<string, StoredDelivery>()

  async createEndpoint(input: CreateEndpointInput): Promise<StoredEndpoint> {
    const endpoint: StoredEndpoint = {
      id: `wep_${randomUUID()}`,
      installationId: input.installationId,
      url: input.url,
      secret: generateWebhookSecret(),
      events: [...input.events],
      enabled: true,
    }
    this.endpoints.set(endpoint.id, endpoint)
    return endpoint
  }

  async listEndpoints(installationId: string): Promise<StoredEndpoint[]> {
    return [...this.endpoints.values()].filter((e) => e.installationId === installationId)
  }

  async endpointsFor(installationId: string, event: string): Promise<StoredEndpoint[]> {
    return [...this.endpoints.values()].filter(
      (e) => e.enabled && e.installationId === installationId && e.events.includes(event),
    )
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const ep = this.endpoints.get(id)
    if (ep) ep.enabled = enabled
  }

  async recordDelivery(input: RecordDeliveryInput): Promise<StoredDelivery> {
    const row: StoredDelivery = {
      id: randomUUID(),
      endpointId: input.endpointId,
      event: input.event,
      payload: input.payload,
      status: 'pending',
      attempts: 0,
      lastCode: null,
      lastError: null,
      nextAttempt: null,
    }
    this.deliveries.set(row.id, row)
    return row
  }

  async settleDelivery(id: string, outcome: DeliveryOutcome): Promise<StoredDelivery> {
    const row = this.deliveries.get(id)
    if (!row) throw new Error(`delivery ${id} not found`)
    return applyOutcome(row, outcome)
  }
}
