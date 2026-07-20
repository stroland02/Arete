import { describe, it, expect, vi } from 'vitest'
import type { Request, Response } from 'express'
import { createInternalAuthMiddleware, tokenMatches } from './internal-auth.js'

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

describe('createInternalAuthMiddleware', () => {
  it('503s (fail closed) when INTERNAL_API_TOKEN is not configured', () => {
    const mw = createInternalAuthMiddleware(() => undefined)
    const res = fakeRes()
    const next = vi.fn()
    mw(req('Bearer anything'), res, next)
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'internal_auth_not_configured' })
    expect(next).not.toHaveBeenCalled()
  })

  it('401s a missing or wrong token without leaking detail', () => {
    const mw = createInternalAuthMiddleware(() => 's3cret')
    for (const header of [undefined, 'Bearer nope00', 'Token s3cret']) {
      const res = fakeRes()
      const next = vi.fn()
      mw(req(header), res, next)
      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ error: 'unauthorized' })
      expect(next).not.toHaveBeenCalled()
    }
  })

  it('calls next() for the correct token', () => {
    const mw = createInternalAuthMiddleware(() => 's3cret')
    const res = fakeRes()
    const next = vi.fn()
    mw(req('Bearer s3cret'), res, next)
    expect(res.statusCode).toBe(0)
    expect(next).toHaveBeenCalledOnce()
  })

  it('reads the token per-request, not at construction time', () => {
    let token: string | undefined
    const mw = createInternalAuthMiddleware(() => token)
    const res503 = fakeRes()
    mw(req('Bearer late'), res503, vi.fn())
    expect(res503.statusCode).toBe(503)

    token = 'late'
    const res = fakeRes()
    const next = vi.fn()
    mw(req('Bearer late'), res, next)
    expect(next).toHaveBeenCalledOnce()
  })
})
