import type { DeliveryOutcome } from './deliver.js'
import {
  generateWebhookSecret,
  type CreateEndpointInput,
  type DueDelivery,
  type RecordDeliveryInput,
  type StoredDelivery,
  type StoredEndpoint,
  type WebhookStore,
} from './store.js'

// Production WebhookStore, backed by Prisma (WebhookEndpoint / WebhookDelivery,
// added in migration 20260715120000_add_webhook_endpoints). Depends on the
// minimal slice of the client below rather than the full generated PrismaClient
// so it unit-tests with a fake and typechecks before the client is regenerated.
// The real `prisma.webhookEndpoint` / `.webhookDelivery` delegates appear once
// `prisma generate` runs post-migration — the deferred deployed-env step.

interface EndpointRow {
  id: string
  installationId: string
  url: string
  secret: string
  events: string[]
  enabled: boolean
}

interface DeliveryRow {
  id: string
  endpointId: string
  event: string
  payload: unknown
  status: string
  attempts: number
  lastCode: number | null
  lastError: string | null
  nextAttempt: Date | null
}

/** The subset of PrismaClient PrismaWebhookStore touches. The real client
 *  satisfies this structurally; tests pass a hand-rolled fake. */
export interface WebhookPrismaClient {
  webhookEndpoint: {
    create(args: { data: Omit<EndpointRow, 'id' | 'enabled'> & { enabled?: boolean } }): Promise<EndpointRow>
    findMany(args: { where: { installationId?: string; enabled?: boolean; events?: { has: string } } }): Promise<EndpointRow[]>
    update(args: { where: { id: string }; data: { enabled: boolean } }): Promise<EndpointRow>
  }
  webhookDelivery: {
    create(args: { data: Omit<DeliveryRow, 'id'> }): Promise<DeliveryRow>
    update(args: { where: { id: string }; data: Partial<DeliveryRow> }): Promise<DeliveryRow>
    findMany(args: {
      where: { status?: string; nextAttempt?: { lte: Date } }
      include: { endpoint: true }
    }): Promise<(DeliveryRow & { endpoint: EndpointRow })[]>
  }
}

function toStoredEndpoint(row: EndpointRow): StoredEndpoint {
  return {
    id: row.id,
    installationId: row.installationId,
    url: row.url,
    secret: row.secret,
    events: row.events,
    enabled: row.enabled,
  }
}

function toStoredDelivery(row: DeliveryRow): StoredDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    event: row.event,
    payload: row.payload,
    status: row.status as StoredDelivery['status'],
    attempts: row.attempts,
    lastCode: row.lastCode,
    lastError: row.lastError,
    nextAttempt: row.nextAttempt,
  }
}

export class PrismaWebhookStore implements WebhookStore {
  constructor(private readonly db: WebhookPrismaClient) {}

  async createEndpoint(input: CreateEndpointInput): Promise<StoredEndpoint> {
    const row = await this.db.webhookEndpoint.create({
      data: {
        installationId: input.installationId,
        url: input.url,
        secret: generateWebhookSecret(),
        events: input.events,
        enabled: true,
      },
    })
    return toStoredEndpoint(row)
  }

  async listEndpoints(installationId: string): Promise<StoredEndpoint[]> {
    const rows = await this.db.webhookEndpoint.findMany({ where: { installationId } })
    return rows.map(toStoredEndpoint)
  }

  async endpointsFor(installationId: string, event: string): Promise<StoredEndpoint[]> {
    const rows = await this.db.webhookEndpoint.findMany({
      where: { installationId, enabled: true, events: { has: event } },
    })
    return rows.map(toStoredEndpoint)
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db.webhookEndpoint.update({ where: { id }, data: { enabled } })
  }

  async recordDelivery(input: RecordDeliveryInput): Promise<StoredDelivery> {
    const row = await this.db.webhookDelivery.create({
      data: {
        endpointId: input.endpointId,
        event: input.event,
        payload: input.payload,
        status: 'pending',
        attempts: 0,
        lastCode: null,
        lastError: null,
        nextAttempt: null,
      },
    })
    return toStoredDelivery(row)
  }

  async settleDelivery(id: string, outcome: DeliveryOutcome): Promise<StoredDelivery> {
    const row = await this.db.webhookDelivery.update({
      where: { id },
      data: {
        status: outcome.status,
        attempts: outcome.attempts,
        lastCode: outcome.code,
        lastError: outcome.error,
        nextAttempt: outcome.nextAttemptMs === null ? null : new Date(Date.now() + outcome.nextAttemptMs),
      },
    })
    return toStoredDelivery(row)
  }

  async dueDeliveries(now: Date): Promise<DueDelivery[]> {
    const rows = await this.db.webhookDelivery.findMany({
      where: { status: 'pending', nextAttempt: { lte: now } },
      include: { endpoint: true },
    })
    return rows.map((row) => ({
      delivery: toStoredDelivery(row),
      endpoint: toStoredEndpoint(row.endpoint),
    }))
  }
}
