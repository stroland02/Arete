import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('exchangeOAuthCode', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
  })
  afterEach(() => { global.fetch = originalFetch })

  it('exchanges a code for a token, computing an absolute expiresAt from expires_in', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok_abc', refresh_token: 'refresh_abc', expires_in: 3600, token_type: 'Bearer' }),
    }) as any

    const { exchangeOAuthCode } = await import('./oauth-token-exchange.js')
    const result = await exchangeOAuthCode('vercel', 'auth-code-123')
    expect(result).toEqual({
      accessToken: 'tok_abc',
      refreshToken: 'refresh_abc',
      expiresAt: new Date('2026-07-11T01:00:00Z').getTime(),
      tokenType: 'Bearer',
    })
    vi.useRealTimers()
  })

  it('handles a long-lived token with no expires_in (expiresAt: null)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok_abc', token_type: 'Bearer' }),
    }) as any
    const { exchangeOAuthCode } = await import('./oauth-token-exchange.js')
    const result = await exchangeOAuthCode('vercel', 'auth-code-123')
    expect(result?.expiresAt).toBeNull()
    expect(result?.refreshToken).toBeNull()
  })

  it('returns null (never throws) on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 }) as any
    const { exchangeOAuthCode } = await import('./oauth-token-exchange.js')
    const result = await exchangeOAuthCode('vercel', 'bad-code')
    expect(result).toBeNull()
  })

  it('returns null (never throws) on a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any
    const { exchangeOAuthCode } = await import('./oauth-token-exchange.js')
    const result = await exchangeOAuthCode('vercel', 'auth-code-123')
    expect(result).toBeNull()
  })

  it('posts form-encoded body with grant_type=authorization_code and client credentials', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok_abc' }) }) as any
    const { exchangeOAuthCode } = await import('./oauth-token-exchange.js')
    await exchangeOAuthCode('vercel', 'auth-code-123')
    const [calledUrl, calledOptions] = (global.fetch as any).mock.calls[0]
    expect(calledUrl).toBe('https://api.vercel.com/v2/oauth/access_token')
    const body = new URLSearchParams(calledOptions.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code-123')
    expect(body.get('client_id')).toBe('client-1')
    expect(body.get('client_secret')).toBe('secret-1')
  })
})

describe('refreshOAuthToken', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('POSTHOG_OAUTH_CLIENT_ID', 'client-2')
    vi.stubEnv('POSTHOG_OAUTH_CLIENT_SECRET', 'secret-2')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
  })
  afterEach(() => { global.fetch = originalFetch })

  it('posts grant_type=refresh_token with the supplied refresh token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new_tok', refresh_token: 'new_refresh', expires_in: 3600, token_type: 'Bearer' }),
    }) as any
    const { refreshOAuthToken } = await import('./oauth-token-exchange.js')
    const result = await refreshOAuthToken('posthog', 'old_refresh_tok')
    expect(result?.accessToken).toBe('new_tok')
    const [, calledOptions] = (global.fetch as any).mock.calls[0]
    const body = new URLSearchParams(calledOptions.body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('old_refresh_tok')
  })

  it('returns null (never throws) on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any
    const { refreshOAuthToken } = await import('./oauth-token-exchange.js')
    const result = await refreshOAuthToken('posthog', 'bad_refresh_tok')
    expect(result).toBeNull()
  })
})
