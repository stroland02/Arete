import { describe, it, expect, vi } from 'vitest'
import type { Request, Response } from 'express'
import { createContextMapFileHandler } from './file-handler.js'

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

const req = (query: Record<string, unknown>) => ({ query }) as unknown as Request

describe('createContextMapFileHandler', () => {
  it('400s when installationId is missing or non-numeric', async () => {
    const handler = createContextMapFileHandler(vi.fn())
    const res = fakeRes()
    await handler(req({ path: 'src/a.ts' }), res, vi.fn())
    expect(res.statusCode).toBe(400)

    const res2 = fakeRes()
    await handler(req({ installationId: 'abc', path: 'src/a.ts' }), res2, vi.fn())
    expect(res2.statusCode).toBe(400)
  })

  it('400s when path is missing', async () => {
    const handler = createContextMapFileHandler(vi.fn())
    const res = fakeRes()
    await handler(req({ installationId: '42' }), res, vi.fn())
    expect(res.statusCode).toBe(400)
  })

  it('passes the parsed args to the runner and returns its envelope with 200', async () => {
    const run = vi.fn(async () => ({ ok: true as const, path: 'src/a.ts', text: 'x', truncated: false }))
    const handler = createContextMapFileHandler(run)
    const res = fakeRes()
    await handler(req({ installationId: '42', path: 'src/a.ts' }), res, vi.fn())
    expect(run).toHaveBeenCalledWith({ externalInstallationId: 42, path: 'src/a.ts' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, path: 'src/a.ts', text: 'x', truncated: false })
  })

  it('fails soft to the unavailable envelope if the runner throws', async () => {
    const handler = createContextMapFileHandler(vi.fn(async () => Promise.reject(new Error('boom'))))
    const res = fakeRes()
    await handler(req({ installationId: '42', path: 'src/a.ts' }), res, vi.fn())
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: false, reason: 'unavailable' })
  })
})
