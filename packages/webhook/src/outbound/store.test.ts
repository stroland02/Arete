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
