import { describe, expect, test } from 'vitest'
import {
  generateWebhookSecret,
  InMemoryWebhookStore,
  toPublicEndpoint,
} from './store.js'

describe('generateWebhookSecret', () => {
  test('is whsec_-prefixed and unpredictable', () => {
    const a = generateWebhookSecret()
    const b = generateWebhookSecret()
    expect(a.startsWith('whsec_')).toBe(true)
    expect(a.length).toBeGreaterThan('whsec_'.length + 16)
    expect(a).not.toBe(b)
  })
})

describe('toPublicEndpoint', () => {
  test('never exposes the secret', () => {
    const pub = toPublicEndpoint({
      id: 'wep_1',
      installationId: 'inst_1',
      url: 'https://example.com/hook',
      secret: 'whsec_supersecret',
      events: ['review.created'],
      enabled: true,
    })
    expect(pub).not.toHaveProperty('secret')
    expect(JSON.stringify(pub)).not.toContain('supersecret')
    expect(pub).toMatchObject({ id: 'wep_1', url: 'https://example.com/hook', enabled: true })
  })
})

describe('InMemoryWebhookStore', () => {
  test('createEndpoint mints a secret and scopes to the installation', async () => {
    const store = new InMemoryWebhookStore()
    const ep = await store.createEndpoint({
      installationId: 'inst_1',
      url: 'https://example.com/hook',
      events: ['review.created', 'review.updated'],
    })
    expect(ep.secret.startsWith('whsec_')).toBe(true)
    expect(ep.installationId).toBe('inst_1')
  })

  test('endpointsFor returns only enabled endpoints of that installation subscribed to the event', async () => {
    const store = new InMemoryWebhookStore()
    await store.createEndpoint({ installationId: 'inst_1', url: 'https://a', events: ['review.created'] })
    await store.createEndpoint({ installationId: 'inst_1', url: 'https://b', events: ['review.updated'] })
    const other = await store.createEndpoint({ installationId: 'inst_2', url: 'https://c', events: ['review.created'] })
    await store.setEnabled(other.id, true)

    const matches = await store.endpointsFor('inst_1', 'review.created')
    expect(matches.map((e) => e.url)).toEqual(['https://a'])
  })

  // Adversarial cross-tenant isolation: with the HTTP management API removed,
  // the store is the surface through which internal/seeded endpoints are created.
  // A query scoped to tenant B must NEVER surface tenant A's endpoint — not via
  // listEndpoints, not via endpointsFor — and must never expose A's secret.
  test('a tenant B query never reads tenant A endpoints or A\'s secret', async () => {
    const store = new InMemoryWebhookStore()
    const tenantA = await store.createEndpoint({
      installationId: 'tenant-A',
      url: 'https://a.example/hook',
      events: ['review.created'],
    })

    // Tenant B enumerates: sees nothing of A's.
    expect(await store.listEndpoints('tenant-B')).toEqual([])
    expect(await store.endpointsFor('tenant-B', 'review.created')).toEqual([])

    // And A's secret never appears in anything B can observe.
    const bView = JSON.stringify([
      await store.listEndpoints('tenant-B'),
      await store.endpointsFor('tenant-B', 'review.created'),
    ])
    expect(bView).not.toContain(tenantA.secret)
    expect(bView).not.toContain('whsec_')

    // Sanity: tenant A still reads its own endpoint (scoping isolates, not erases).
    expect((await store.listEndpoints('tenant-A')).map((e) => e.id)).toEqual([tenantA.id])
  })

  test('recordDelivery creates a pending row; settleDelivery applies the outcome', async () => {
    const store = new InMemoryWebhookStore()
    const ep = await store.createEndpoint({ installationId: 'inst_1', url: 'https://a', events: ['review.created'] })

    const row = await store.recordDelivery({ endpointId: ep.id, event: 'review.created', payload: { hello: 'world' } })
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(0)
    expect(row.id).toBeTruthy()

    const settled = await store.settleDelivery(row.id, {
      status: 'delivered',
      code: 200,
      error: null,
      attempts: 1,
      nextAttemptMs: null,
    })
    expect(settled.status).toBe('delivered')
    expect(settled.attempts).toBe(1)
    expect(settled.lastCode).toBe(200)
    expect(settled.nextAttempt).toBeNull()
  })
})
