import { describe, it, expect, beforeEach } from 'vitest'
import { mintInternalToken, loadKeyset, InternalTokenNotConfigured, INTERNAL_TOKEN_DEFAULT_TTL_SECONDS } from './index.js'

const KEYS = JSON.stringify({ k1: 'a'.repeat(48) })
beforeEach(() => {
  process.env.INTERNAL_TOKEN_SIGNING_KEYS = KEYS
  process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k1'
  delete process.env.INTERNAL_TOKEN_TTL_SECONDS
})

describe('mintInternalToken', () => {
  it('produces a compact JWT with the active kid in the protected header and the default TTL', async () => {
    const now = 1_700_000_000
    const token = await mintInternalToken('arete-webhook', { now })
    const parts = token.split('.')
    expect(parts).toHaveLength(3)

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT', kid: 'k1' })

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    expect(payload).toEqual({
      iss: 'arete-webhook',
      aud: 'arete-internal',
      iat: now,
      exp: now + INTERNAL_TOKEN_DEFAULT_TTL_SECONDS,
    })
  })

  it('is deterministic: identical inputs (including a fixed now) produce an identical token', async () => {
    const now = 1_700_000_000
    const a = await mintInternalToken('arete-webhook', { now })
    const b = await mintInternalToken('arete-webhook', { now })
    expect(a).toBe(b)
  })

  it('honors INTERNAL_TOKEN_TTL_SECONDS when set', async () => {
    process.env.INTERNAL_TOKEN_TTL_SECONDS = '30'
    const now = 1_700_000_000
    const token = await mintInternalToken('arete-webhook', { now })
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    expect(payload.exp).toBe(now + 30)
  })

  it('throws InternalTokenNotConfigured when the keyset is missing', async () => {
    delete process.env.INTERNAL_TOKEN_SIGNING_KEYS
    await expect(mintInternalToken('arete-webhook')).rejects.toBeInstanceOf(InternalTokenNotConfigured)
  })

  it('throws InternalTokenNotConfigured when the active kid is not in the keyset', async () => {
    process.env.INTERNAL_TOKEN_ACTIVE_KID = 'missing'
    await expect(mintInternalToken('arete-webhook')).rejects.toBeInstanceOf(InternalTokenNotConfigured)
  })
})

describe('loadKeyset', () => {
  it('returns null when INTERNAL_TOKEN_SIGNING_KEYS is missing', () => {
    delete process.env.INTERNAL_TOKEN_SIGNING_KEYS
    expect(loadKeyset()).toBeNull()
  })

  it('returns null for an empty object', () => {
    process.env.INTERNAL_TOKEN_SIGNING_KEYS = '{}'
    expect(loadKeyset()).toBeNull()
  })

  it('returns null for unparseable JSON', () => {
    process.env.INTERNAL_TOKEN_SIGNING_KEYS = 'not-json'
    expect(loadKeyset()).toBeNull()
  })

  it('returns null when the active kid names a kid not present in keys', () => {
    process.env.INTERNAL_TOKEN_ACTIVE_KID = 'nope'
    expect(loadKeyset()).toBeNull()
  })

  it('returns the parsed keyset and active kid when valid', () => {
    expect(loadKeyset()).toEqual({ keys: { k1: 'a'.repeat(48) }, activeKid: 'k1' })
  })
})
