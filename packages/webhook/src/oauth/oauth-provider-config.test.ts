import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('getOAuthProviderConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('returns Vercel config when its env vars are set', async () => {
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    const { getOAuthProviderConfig } = await import('./oauth-provider-config.js')
    const config = getOAuthProviderConfig('vercel')
    expect(config.clientId).toBe('client-1')
    expect(config.authorizeUrl).toBe('https://vercel.com/integrations/install')
    expect(config.redirectUri).toBe('https://areté.example.com/oauth/vercel/callback')
  })

  it('throws a clear error when Vercel env vars are missing', async () => {
    const { getOAuthProviderConfig } = await import('./oauth-provider-config.js')
    expect(() => getOAuthProviderConfig('vercel')).toThrow(/VERCEL_OAUTH_CLIENT_ID/)
  })

  it('returns PostHog config when its env vars are set', async () => {
    vi.stubEnv('POSTHOG_OAUTH_CLIENT_ID', 'client-2')
    vi.stubEnv('POSTHOG_OAUTH_CLIENT_SECRET', 'secret-2')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    const { getOAuthProviderConfig } = await import('./oauth-provider-config.js')
    const config = getOAuthProviderConfig('posthog')
    expect(config.clientId).toBe('client-2')
    expect(config.tokenUrl).toBe('https://oauth.posthog.com/oauth/token/')
  })
})
