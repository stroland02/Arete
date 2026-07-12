import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('buildOAuthAuthorizeUrl', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('VERCEL_OAUTH_CLIENT_ID', 'client-1')
    vi.stubEnv('VERCEL_OAUTH_CLIENT_SECRET', 'secret-1')
    vi.stubEnv('OAUTH_REDIRECT_BASE_URL', 'https://areté.example.com')
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64))
  })

  it('builds a valid authorize URL with client_id, redirect_uri, and a signed state', async () => {
    const { buildOAuthAuthorizeUrl } = await import('./build-authorize-url.js')
    const url = new URL(buildOAuthAuthorizeUrl('vercel', 'inst-123'))
    expect(url.hostname).toBe('vercel.com')
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('redirect_uri')).toBe('https://areté.example.com/oauth/vercel/callback')
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('embeds a state that verifies back to the same installationId and provider', async () => {
    const { buildOAuthAuthorizeUrl } = await import('./build-authorize-url.js')
    const { verifyOAuthState } = await import('./oauth-state.js')
    const url = new URL(buildOAuthAuthorizeUrl('vercel', 'inst-123'))
    const state = url.searchParams.get('state')!
    expect(verifyOAuthState(state)).toEqual({ installationId: 'inst-123', provider: 'vercel' })
  })
})
