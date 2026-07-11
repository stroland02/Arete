import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('OAuth state token', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('TELEMETRY_ENCRYPTION_KEY', 'a'.repeat(64))
  })

  it('round-trips installationId and provider through sign/verify', async () => {
    const { signOAuthState, verifyOAuthState } = await import('./oauth-state.js')
    const token = signOAuthState('inst-123', 'vercel')
    const result = verifyOAuthState(token)
    expect(result).toEqual({ installationId: 'inst-123', provider: 'vercel' })
  })

  it('rejects a tampered token', async () => {
    const { signOAuthState, verifyOAuthState } = await import('./oauth-state.js')
    const token = signOAuthState('inst-123', 'vercel')
    // Flip an interior character, not the last one: the token's decoded length
    // is not a multiple of 3, so the final base64url char carries only 2
    // significant bits — swapping it is a decode no-op ~30% of the time and
    // made this test flaky. An interior char is always fully significant.
    const tampered = token.slice(0, 10) + (token[10] === 'a' ? 'b' : 'a') + token.slice(11)
    expect(verifyOAuthState(tampered)).toBeNull()
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    const { signOAuthState, verifyOAuthState } = await import('./oauth-state.js')
    const token = signOAuthState('inst-123', 'vercel')
    vi.setSystemTime(new Date('2026-07-11T00:11:00Z')) // past the 10-minute TTL
    expect(verifyOAuthState(token)).toBeNull()
    vi.useRealTimers()
  })

  it('rejects malformed input without throwing', async () => {
    const { verifyOAuthState } = await import('./oauth-state.js')
    expect(verifyOAuthState('not-a-real-token')).toBeNull()
    expect(verifyOAuthState('')).toBeNull()
  })
})
