import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeReqRes(query: Record<string, string>) {
  const req = { params: { provider: 'vercel' }, query } as any
  const statusCalls: number[] = []
  const res = {
    status: vi.fn((code: number) => { statusCalls.push(code); return res }),
    send: vi.fn(),
    redirect: vi.fn(),
  } as any
  return { req, res, statusCalls }
}

describe('handleOAuthCallback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64))
  })

  it('rejects a request with an invalid/missing state', async () => {
    const { handleOAuthCallback } = await import('./oauth-callback-handler.js')
    const { req, res } = makeReqRes({ code: 'auth-code', state: 'garbage' })
    await handleOAuthCallback(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('exchanges the code, encrypts, and upserts a TelemetryConnection row on success', async () => {
    vi.doMock('./oauth-token-exchange.js', () => ({
      exchangeOAuthCode: vi.fn().mockResolvedValue({
        accessToken: 'tok_abc', refreshToken: 'refresh_abc', expiresAt: 1234567890, tokenType: 'Bearer',
      }),
    }))
    const upsertMock = vi.fn().mockResolvedValue({})
    vi.doMock('../db.js', () => ({ prisma: { telemetryConnection: { upsert: upsertMock } } }))

    const { signOAuthState } = await import('./oauth-state.js')
    const { handleOAuthCallback } = await import('./oauth-callback-handler.js')
    const state = signOAuthState('inst-123', 'vercel')
    const { req, res } = makeReqRes({ code: 'auth-code', state })

    await handleOAuthCallback(req, res)

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const call = upsertMock.mock.calls[0][0]
    expect(call.where).toEqual({ installationId_provider: { installationId: 'inst-123', provider: 'vercel' } })
    expect(call.create.authMethod).toBe('oauth')
    expect(res.redirect).toHaveBeenCalled()
  })

  it('shows a clean failure response when token exchange fails, without throwing', async () => {
    vi.doMock('./oauth-token-exchange.js', () => ({ exchangeOAuthCode: vi.fn().mockResolvedValue(null) }))
    const { signOAuthState } = await import('./oauth-state.js')
    const { handleOAuthCallback } = await import('./oauth-callback-handler.js')
    const state = signOAuthState('inst-123', 'vercel')
    const { req, res } = makeReqRes({ code: 'auth-code', state })

    await handleOAuthCallback(req, res)
    expect(res.status).toHaveBeenCalledWith(502)
  })
})
