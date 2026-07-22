import { describe, it, expect, beforeEach } from 'vitest'
import { mintInternalToken, verifyInternalToken, InternalTokenNotConfigured } from './index.js'

const KEYS = JSON.stringify({ k1: 'a'.repeat(48) })
beforeEach(() => {
  process.env.INTERNAL_TOKEN_SIGNING_KEYS = KEYS
  process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k1'
})

describe('verifyInternalToken', () => {
  it('mints and verifies a fresh token', async () => {
    const t = await mintInternalToken('arete-webhook')
    const r = await verifyInternalToken(`Bearer ${t}`)
    expect(r).toEqual({ ok: true, iss: 'arete-webhook', kid: 'k1' })
  })

  it('rejects an expired token (the DoD gate — clock in the future)', async () => {
    const t = await mintInternalToken('arete-webhook', { now: 1_700_000_000 })
    // 10 years later, well past the 120s TTL
    const r = await verifyInternalToken(`Bearer ${t}`, { now: 1_700_000_000 + 315_360_000 })
    expect(r).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a token whose kid was revoked (removed from the keyset)', async () => {
    const t = await mintInternalToken('arete-webhook')
    process.env.INTERNAL_TOKEN_SIGNING_KEYS = JSON.stringify({ k2: 'b'.repeat(48) })
    process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k2'
    expect(await verifyInternalToken(`Bearer ${t}`)).toEqual({ ok: false, reason: 'unknown_kid' })
  })

  it('accepts a token signed by a non-active kid still present (rotation window)', async () => {
    const t = await mintInternalToken('arete-webhook') // signed k1
    process.env.INTERNAL_TOKEN_SIGNING_KEYS = JSON.stringify({ k1: 'a'.repeat(48), k2: 'b'.repeat(48) })
    process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k2' // now minting k2, but k1 still valid
    expect(await verifyInternalToken(`Bearer ${t}`)).toMatchObject({ ok: true, kid: 'k1' })
  })

  it('rejects a tampered signature', async () => {
    const t = await mintInternalToken('arete-webhook')
    const bad = t.slice(0, -2) + (t.endsWith('aa') ? 'bb' : 'aa')
    expect(await verifyInternalToken(`Bearer ${bad}`)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('answers unconfigured distinctly from unauthorized', async () => {
    delete process.env.INTERNAL_TOKEN_SIGNING_KEYS
    await expect(verifyInternalToken('Bearer x')).rejects.toBeInstanceOf(InternalTokenNotConfigured)
  })

  it('returns no_header when the Authorization header is absent', async () => {
    expect(await verifyInternalToken(undefined)).toEqual({ ok: false, reason: 'no_header' })
  })

  it('returns malformed for a header that is not a Bearer token', async () => {
    expect(await verifyInternalToken('Basic abc123')).toEqual({ ok: false, reason: 'malformed' })
  })

  it('returns malformed for a Bearer value that is not a parseable JWT', async () => {
    expect(await verifyInternalToken('Bearer not-a-jwt')).toEqual({ ok: false, reason: 'malformed' })
  })
})
