import { describe, it, expect, vi } from 'vitest'
import { InMemoryWebhookStore } from './store.js'
import {
  createTenantEndpoint,
  listTenantEndpoints,
  setTenantEndpointEnabled,
  type ManagementDeps,
} from './management.js'

// These are the mutation tests for the vulnerability that pulled this API from
// server.ts: an unauthenticated, client-supplied installationId let any caller
// list any tenant's endpoints AND receive their whsec_ signing secret. This
// module cannot fix the authentication half (its caller owns that) — what it
// must guarantee is that even given a correct installationId, the secret never
// leaks on a read path and one tenant can never touch another's rows.

const INST_A = 'inst-a'
const INST_B = 'inst-b'

/** Never hits real DNS: the SSRF guard's own behavior is covered by
 *  @arete/net-guard's tests, so here it is stubbed to isolate this layer. */
function deps(store = new InMemoryWebhookStore(), assertUrl = vi.fn(async () => {})) {
  return { store, assertUrl } satisfies ManagementDeps
}

describe('createTenantEndpoint', () => {
  it('returns the signing secret exactly once, at creation', async () => {
    const d = deps()

    const created = await createTenantEndpoint(
      { installationId: INST_A, url: 'https://example.test/hook', events: ['review.created'] },
      d,
    )

    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.data.secret).toMatch(/^whsec_/)
    // ...and the endpoint object accompanying it is already stripped.
    expect(created.data.endpoint).not.toHaveProperty('secret')
  })

  it('refuses a destination the SSRF guard rejects', async () => {
    const assertUrl = vi.fn(async () => {
      throw new Error('destination resolves to a private address')
    })
    const d = deps(new InMemoryWebhookStore(), assertUrl)

    const result = await createTenantEndpoint(
      {
        installationId: INST_A,
        url: 'http://169.254.169.254/latest/meta-data',
        events: ['review.created'],
      },
      d,
    )

    expect(result).toMatchObject({ ok: false, reason: 'invalid_url' })
    // Nothing was persisted for a rejected destination.
    expect(await d.store.listEndpoints(INST_A)).toHaveLength(0)
  })

  it('refuses events outside the allowed set, and refuses an empty subscription', async () => {
    const d = deps()

    const bogus = await createTenantEndpoint(
      {
        installationId: INST_A,
        url: 'https://example.test/hook',
        events: ['review.created', 'billing.exported'],
      },
      d,
    )
    const empty = await createTenantEndpoint(
      { installationId: INST_A, url: 'https://example.test/hook', events: [] },
      d,
    )

    expect(bogus).toMatchObject({ ok: false, reason: 'invalid_events' })
    expect(empty).toMatchObject({ ok: false, reason: 'invalid_events' })
    // The SSRF guard is never even consulted for a malformed subscription.
    expect(d.assertUrl).not.toHaveBeenCalled()
  })
})

describe('listTenantEndpoints', () => {
  // THE LEAK THIS API WAS PULLED FOR. With the secret an attacker forges
  // payloads that pass the receiver's signature check.
  it('NEVER returns the signing secret', async () => {
    const d = deps()
    await createTenantEndpoint(
      { installationId: INST_A, url: 'https://example.test/hook', events: ['review.created'] },
      d,
    )

    const listed = await listTenantEndpoints(INST_A, d)

    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.data).toHaveLength(1)
    expect(listed.data[0]).not.toHaveProperty('secret')
    expect(JSON.stringify(listed.data)).not.toContain('whsec_')
  })

  it("returns only the requested tenant's endpoints", async () => {
    const d = deps()
    await createTenantEndpoint(
      { installationId: INST_A, url: 'https://a.test/hook', events: ['review.created'] },
      d,
    )
    await createTenantEndpoint(
      { installationId: INST_B, url: 'https://b.test/hook', events: ['review.created'] },
      d,
    )

    const listed = await listTenantEndpoints(INST_A, d)

    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.data.map((e) => e.url)).toEqual(['https://a.test/hook'])
  })
})

describe('setTenantEndpointEnabled', () => {
  // store.setEnabled(id, enabled) is NOT tenant-scoped — it will disable any row
  // in the table. Passing an API-supplied id straight to it is a cross-tenant
  // write, so ownership must be resolved first.
  it("cannot touch another tenant's endpoint, and does not reveal that it exists", async () => {
    const d = deps()
    const victim = await createTenantEndpoint(
      { installationId: INST_B, url: 'https://b.test/hook', events: ['review.created'] },
      d,
    )
    expect(victim.ok).toBe(true)
    if (!victim.ok) return
    const setEnabled = vi.spyOn(d.store, 'setEnabled')

    // Tenant A presents tenant B's real endpoint id.
    const result = await setTenantEndpointEnabled(
      { installationId: INST_A, id: victim.data.endpoint.id, enabled: false },
      d,
    )

    // not_found — identical to an id that never existed.
    expect(result).toEqual({ ok: false, reason: 'not_found' })
    expect(setEnabled).not.toHaveBeenCalled()
    // The victim's endpoint is untouched.
    const stillEnabled = await d.store.listEndpoints(INST_B)
    expect(stillEnabled[0].enabled).toBe(true)
  })

  it('reports a genuinely missing id the same way as a cross-tenant one', async () => {
    const d = deps()

    const result = await setTenantEndpointEnabled(
      { installationId: INST_A, id: 'does-not-exist', enabled: false },
      d,
    )

    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('disables an endpoint the caller owns', async () => {
    const d = deps()
    const mine = await createTenantEndpoint(
      { installationId: INST_A, url: 'https://a.test/hook', events: ['review.created'] },
      d,
    )
    expect(mine.ok).toBe(true)
    if (!mine.ok) return

    const result = await setTenantEndpointEnabled(
      { installationId: INST_A, id: mine.data.endpoint.id, enabled: false },
      d,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.enabled).toBe(false)
    expect(result.data).not.toHaveProperty('secret')
    const rows = await d.store.listEndpoints(INST_A)
    expect(rows[0].enabled).toBe(false)
  })
})
