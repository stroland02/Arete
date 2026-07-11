import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('getValidOAuthAccessToken', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64))
  })

  it('returns the stored access token directly when not expired', async () => {
    const { encryptCredentials } = await import('../telemetry/credentials.js')
    const farFuture = Date.now() + 60 * 60 * 1000
    const stored = encryptCredentials({ accessToken: 'still_valid', refreshToken: 'r1', expiresAt: farFuture, tokenType: 'Bearer' })

    vi.doMock('../db.js', () => ({
      prisma: {
        telemetryConnection: {
          findUnique: vi.fn().mockResolvedValue({ credentials: stored, authMethod: 'oauth' }),
          update: vi.fn(),
        },
      },
    }))

    const { getValidOAuthAccessToken } = await import('./get-valid-oauth-token.js')
    const token = await getValidOAuthAccessToken('inst-123', 'vercel')
    expect(token).toBe('still_valid')
  })

  it('refreshes and persists a new token when the stored one is expired', async () => {
    const { encryptCredentials } = await import('../telemetry/credentials.js')
    const past = Date.now() - 1000
    const stored = encryptCredentials({ accessToken: 'expired_tok', refreshToken: 'r1', expiresAt: past, tokenType: 'Bearer' })

    const updateMock = vi.fn().mockResolvedValue({})
    vi.doMock('../db.js', () => ({
      prisma: {
        telemetryConnection: {
          findUnique: vi.fn().mockResolvedValue({ credentials: stored, authMethod: 'oauth' }),
          update: updateMock,
        },
      },
    }))
    vi.doMock('./oauth-token-exchange.js', () => ({
      refreshOAuthToken: vi.fn().mockResolvedValue({
        accessToken: 'refreshed_tok', refreshToken: 'r2', expiresAt: Date.now() + 3600_000, tokenType: 'Bearer',
      }),
    }))

    const { getValidOAuthAccessToken } = await import('./get-valid-oauth-token.js')
    const token = await getValidOAuthAccessToken('inst-123', 'vercel')
    expect(token).toBe('refreshed_tok')
    expect(updateMock).toHaveBeenCalledTimes(1)
  })

  it('returns null (never throws) when no connection exists', async () => {
    vi.doMock('../db.js', () => ({
      prisma: { telemetryConnection: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() } },
    }))
    const { getValidOAuthAccessToken } = await import('./get-valid-oauth-token.js')
    const token = await getValidOAuthAccessToken('inst-123', 'vercel')
    expect(token).toBeNull()
  })

  it('returns null (never throws) when refresh fails', async () => {
    const { encryptCredentials } = await import('../telemetry/credentials.js')
    const past = Date.now() - 1000
    const stored = encryptCredentials({ accessToken: 'expired_tok', refreshToken: 'r1', expiresAt: past, tokenType: 'Bearer' })
    vi.doMock('../db.js', () => ({
      prisma: { telemetryConnection: { findUnique: vi.fn().mockResolvedValue({ credentials: stored, authMethod: 'oauth' }), update: vi.fn() } },
    }))
    vi.doMock('./oauth-token-exchange.js', () => ({ refreshOAuthToken: vi.fn().mockResolvedValue(null) }))

    const { getValidOAuthAccessToken } = await import('./get-valid-oauth-token.js')
    const token = await getValidOAuthAccessToken('inst-123', 'vercel')
    expect(token).toBeNull()
  })

  it('returns null (not an unhandled rejection) when a refresh is attempted with missing OAuth env config', async () => {
    // Uses the REAL oauth-token-exchange module — no doMock — so the actual
    // config-validation throw from getOAuthProviderConfig (Task 3 throws for
    // missing client id/secret rather than resolving null) is exercised.
    const { encryptCredentials } = await import('../telemetry/credentials.js')
    const past = Date.now() - 1000
    const stored = encryptCredentials({ accessToken: 'expired_tok', refreshToken: 'r1', expiresAt: past, tokenType: 'Bearer' })

    const updateMock = vi.fn().mockResolvedValue({})
    vi.doMock('../db.js', () => ({
      prisma: {
        telemetryConnection: {
          findUnique: vi.fn().mockResolvedValue({ credentials: stored, authMethod: 'oauth' }),
          update: updateMock,
        },
      },
    }))
    // Remove the provider's OAuth app credentials so getOAuthProviderConfig throws.
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', '')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', '')
    // Guard: the config throw must happen before any network call is made.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { getValidOAuthAccessToken } = await import('./get-valid-oauth-token.js')
    await expect(getValidOAuthAccessToken('inst-123', 'vercel')).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
