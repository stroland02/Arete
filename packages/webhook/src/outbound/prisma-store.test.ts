import { describe, expect, test } from 'vitest'
import { PrismaWebhookStore, type WebhookPrismaClient } from './prisma-store.js'
import { toPublicEndpoint } from './store.js'

// Fake Prisma delegate slice (same hand-rolled-fake pattern @arete/dashboard
// uses for its Prisma tests). Mimics @default(uuid()) id generation and the
// array `has` filter. No real database.
function fakePrisma(): WebhookPrismaClient & { _endpoints: Map<string, any>; _deliveries: Map<string, any> } {
  const endpoints = new Map<string, any>()
  const deliveries = new Map<string, any>()
  let n = 0
  return {
    _endpoints: endpoints,
    _deliveries: deliveries,
    webhookEndpoint: {
      async create({ data }: any) {
        const row = { id: `wep_${++n}`, enabled: true, createdAt: new Date(), ...data }
        endpoints.set(row.id, row)
        return row
      },
      async findMany({ where }: any) {
        let rows = [...endpoints.values()]
        if (where?.installationId) rows = rows.filter((r) => r.installationId === where.installationId)
        if (where?.enabled !== undefined) rows = rows.filter((r) => r.enabled === where.enabled)
        if (where?.events?.has) rows = rows.filter((r) => r.events.includes(where.events.has))
        return rows
      },
      async update({ where, data }: any) {
        const row = endpoints.get(where.id)
        Object.assign(row, data)
        return row
      },
    },
    webhookDelivery: {
      async create({ data }: any) {
        const row = { id: `wd_${++n}`, createdAt: new Date(), updatedAt: new Date(), ...data }
        deliveries.set(row.id, row)
        return row
      },
      async update({ where, data }: any) {
        const row = deliveries.get(where.id)
        Object.assign(row, data)
        return row
      },
      async findMany({ where, include }: any) {
        let rows = [...deliveries.values()]
        if (where?.status) rows = rows.filter((r) => r.status === where.status)
        if (where?.nextAttempt?.lte) rows = rows.filter((r) => r.nextAttempt && r.nextAttempt <= where.nextAttempt.lte)
        return include?.endpoint ? rows.map((r) => ({ ...r, endpoint: endpoints.get(r.endpointId) })) : rows
      },
    },
  }
}

describe('PrismaWebhookStore', () => {
  test('createEndpoint persists a row with a minted secret', async () => {
    const db = fakePrisma()
    const store = new PrismaWebhookStore(db)
    const ep = await store.createEndpoint({ installationId: 'inst_1', url: 'https://x/hook', events: ['review.created'] })

    expect(ep.secret).toMatch(/^whsec_/)
    expect(db._endpoints.get(ep.id)?.secret).toBe(ep.secret) // actually written
    // redaction happens at the API boundary
    expect(toPublicEndpoint(ep)).not.toHaveProperty('secret')
  })

  test('listEndpoints returns all endpoints of the installation', async () => {
    const db = fakePrisma()
    const store = new PrismaWebhookStore(db)
    await store.createEndpoint({ installationId: 'inst_1', url: 'https://a', events: ['review.created'] })
    await store.createEndpoint({ installationId: 'inst_2', url: 'https://b', events: ['review.created'] })

    const list = await store.listEndpoints('inst_1')
    expect(list.map((e) => e.url)).toEqual(['https://a'])
  })

  test('endpointsFor filters by enabled + subscribed event', async () => {
    const db = fakePrisma()
    const store = new PrismaWebhookStore(db)
    await store.createEndpoint({ installationId: 'inst_1', url: 'https://a', events: ['review.created'] })
    const off = await store.createEndpoint({ installationId: 'inst_1', url: 'https://b', events: ['review.created'] })
    await store.setEnabled(off.id, false)

    const matches = await store.endpointsFor('inst_1', 'review.created')
    expect(matches.map((e) => e.url)).toEqual(['https://a'])
  })

  test('recordDelivery writes a pending row; settleDelivery applies the outcome', async () => {
    const db = fakePrisma()
    const store = new PrismaWebhookStore(db)
    const row = await store.recordDelivery({ endpointId: 'wep_x', event: 'review.created', payload: { a: 1 } })
    expect(row.status).toBe('pending')
    expect(db._deliveries.get(row.id)?.status).toBe('pending')

    const settled = await store.settleDelivery(row.id, {
      status: 'pending',
      code: 503,
      error: 'non-2xx response: 503',
      attempts: 1,
      nextAttemptMs: 30_000,
    })
    expect(settled.status).toBe('pending')
    expect(settled.attempts).toBe(1)
    expect(settled.lastCode).toBe(503)
    expect(settled.nextAttempt).toBeInstanceOf(Date)
  })
})
