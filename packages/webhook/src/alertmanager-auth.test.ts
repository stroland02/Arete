import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Request, Response } from 'express'
import { mintInternalToken } from '@arete/internal-token'
import { requireAlertmanagerToken, tokenMatches } from './alertmanager-auth.js'

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

describe('tokenMatches', () => {
  it('accepts the exact bearer token, scheme case-insensitive', () => {
    expect(tokenMatches('Bearer s3cret', 's3cret')).toBe(true)
    expect(tokenMatches('bearer s3cret', 's3cret')).toBe(true)
  })

  it('rejects missing, malformed, wrong, and different-length values', () => {
    expect(tokenMatches(undefined, 's3cret')).toBe(false)
    expect(tokenMatches('s3cret', 's3cret')).toBe(false) // no scheme
    expect(tokenMatches('Basic s3cret', 's3cret')).toBe(false)
    expect(tokenMatches('Bearer wrong0', 's3cret')).toBe(false)
    expect(tokenMatches('Bearer s3cret-but-longer', 's3cret')).toBe(false) // must not throw
  })
})

describe('requireAlertmanagerToken', () => {
  const ORIGINAL = process.env.ALERTMANAGER_INGEST_TOKEN

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ALERTMANAGER_INGEST_TOKEN
    else process.env.ALERTMANAGER_INGEST_TOKEN = ORIGINAL
  })

  it('503s (fail closed) when ALERTMANAGER_INGEST_TOKEN is not configured', () => {
    delete process.env.ALERTMANAGER_INGEST_TOKEN
    const res = fakeRes()
    const next = vi.fn()
    requireAlertmanagerToken(req('Bearer anything'), res, next)
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'internal_auth_not_configured' })
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() for the correct static token', () => {
    process.env.ALERTMANAGER_INGEST_TOKEN = 'am-s3cret'
    const res = fakeRes()
    const next = vi.fn()
    requireAlertmanagerToken(req('Bearer am-s3cret'), res, next)
    expect(res.statusCode).toBe(0)
    expect(next).toHaveBeenCalledOnce()
  })

  it('401s a missing or wrong token without leaking detail', () => {
    process.env.ALERTMANAGER_INGEST_TOKEN = 'am-s3cret'
    for (const header of [undefined, 'Bearer nope00', 'Token am-s3cret']) {
      const res = fakeRes()
      const next = vi.fn()
      requireAlertmanagerToken(req(header), res, next)
      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ error: 'unauthorized' })
      expect(next).not.toHaveBeenCalled()
    }
  })

  it('401s a signed internal JWT — different credential now, not a valid caller', async () => {
    const originalKeys = process.env.INTERNAL_TOKEN_SIGNING_KEYS
    const originalKid = process.env.INTERNAL_TOKEN_ACTIVE_KID
    process.env.INTERNAL_TOKEN_SIGNING_KEYS = JSON.stringify({ k1: 'a'.repeat(48) })
    process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k1'
    process.env.ALERTMANAGER_INGEST_TOKEN = 'am-s3cret'
    try {
      const jwt = await mintInternalToken('arete-webhook')
      const res = fakeRes()
      const next = vi.fn()
      requireAlertmanagerToken(req(`Bearer ${jwt}`), res, next)
      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ error: 'unauthorized' })
      expect(next).not.toHaveBeenCalled()
    } finally {
      if (originalKeys === undefined) delete process.env.INTERNAL_TOKEN_SIGNING_KEYS
      else process.env.INTERNAL_TOKEN_SIGNING_KEYS = originalKeys
      if (originalKid === undefined) delete process.env.INTERNAL_TOKEN_ACTIVE_KID
      else process.env.INTERNAL_TOKEN_ACTIVE_KID = originalKid
    }
  })
})
