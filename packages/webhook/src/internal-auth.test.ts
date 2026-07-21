import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Request, Response } from 'express'
import { mintInternalToken } from '@arete/internal-token'
import { createInternalAuthMiddleware, internalAuthHeaders } from './internal-auth.js'

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return res as typeof res & Response
}

const req = (authorization?: string) =>
  ({ headers: authorization ? { authorization } : {} }) as unknown as Request

const KEYS = JSON.stringify({ k1: 'a'.repeat(48) })

describe('internalAuthHeaders', () => {
  const originalKeys = process.env.INTERNAL_TOKEN_SIGNING_KEYS
  const originalKid = process.env.INTERNAL_TOKEN_ACTIVE_KID

  afterEach(() => {
    if (originalKeys === undefined) delete process.env.INTERNAL_TOKEN_SIGNING_KEYS
    else process.env.INTERNAL_TOKEN_SIGNING_KEYS = originalKeys
    if (originalKid === undefined) delete process.env.INTERNAL_TOKEN_ACTIVE_KID
    else process.env.INTERNAL_TOKEN_ACTIVE_KID = originalKid
  })

  it('mints an arete-webhook bearer token that the signed verifier accepts', async () => {
    process.env.INTERNAL_TOKEN_SIGNING_KEYS = KEYS
    process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k1'

    const headers = await internalAuthHeaders()
    expect(headers.authorization).toMatch(/^Bearer .+/)

    const mw = createInternalAuthMiddleware()
    const res = fakeRes()
    const next = vi.fn()
    await mw(req(headers.authorization), res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(0)
  })

  it('returns {} when the keyset is unconfigured (caller stays permissive)', async () => {
    delete process.env.INTERNAL_TOKEN_SIGNING_KEYS
    delete process.env.INTERNAL_TOKEN_ACTIVE_KID
    expect(await internalAuthHeaders()).toEqual({})
  })
})

describe('createInternalAuthMiddleware', () => {
  beforeEach(() => {
    process.env.INTERNAL_TOKEN_SIGNING_KEYS = KEYS
    process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k1'
  })

  afterEach(() => {
    delete process.env.INTERNAL_TOKEN_SIGNING_KEYS
    delete process.env.INTERNAL_TOKEN_ACTIVE_KID
  })

  it('503s (fail closed) when the keyset is not configured', async () => {
    delete process.env.INTERNAL_TOKEN_SIGNING_KEYS
    const mw = createInternalAuthMiddleware()
    const res = fakeRes()
    const next = vi.fn()
    await mw(req('Bearer anything'), res, next)
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'internal_auth_not_configured' })
    expect(next).not.toHaveBeenCalled()
  })

  it('401s a missing or malformed header without leaking detail', async () => {
    const mw = createInternalAuthMiddleware()
    for (const header of [undefined, 'Bearer not-a-jwt', 'Token whatever']) {
      const res = fakeRes()
      const next = vi.fn()
      await mw(req(header), res, next)
      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ error: 'unauthorized' })
      expect(next).not.toHaveBeenCalled()
    }
  })

  it('401s the legacy shared-secret string — clean cutover, no fallback', async () => {
    const mw = createInternalAuthMiddleware()
    const res = fakeRes()
    const next = vi.fn()
    await mw(req('Bearer some-legacy-random-shared-secret'), res, next)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'unauthorized' })
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() for a valid signed token from any issuer', async () => {
    const token = await mintInternalToken('arete-webhook')
    const mw = createInternalAuthMiddleware()
    const res = fakeRes()
    const next = vi.fn()
    await mw(req(`Bearer ${token}`), res, next)
    expect(res.statusCode).toBe(0)
    expect(next).toHaveBeenCalledOnce()
  })

  it('reads the keyset per-request, not at construction time', async () => {
    delete process.env.INTERNAL_TOKEN_SIGNING_KEYS
    const mw = createInternalAuthMiddleware()
    const res503 = fakeRes()
    await mw(req('Bearer late'), res503, vi.fn())
    expect(res503.statusCode).toBe(503)

    process.env.INTERNAL_TOKEN_SIGNING_KEYS = KEYS
    process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k1'
    const token = await mintInternalToken('arete-webhook')
    const res = fakeRes()
    const next = vi.fn()
    await mw(req(`Bearer ${token}`), res, next)
    expect(next).toHaveBeenCalledOnce()
  })
})
