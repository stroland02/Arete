import { describe, it, expect, vi } from 'vitest'

describe('getInstallationOctokit', () => {
  it('calls app.getInstallationOctokit with the given installation id', async () => {
    const mockOctokit = { rest: {} }
    const mockApp = {
      getInstallationOctokit: vi.fn().mockResolvedValue(mockOctokit),
    }
    const { getInstallationOctokit } = await import('./github-auth.js')
    const result = await getInstallationOctokit(mockApp as any, 42)
    expect(mockApp.getInstallationOctokit).toHaveBeenCalledWith(42)
    expect(result).toBe(mockOctokit)
  })
})

describe('getInstallationToken', () => {
  it('calls app.octokit.auth with installation type and returns the token', async () => {
    const mockAuth = vi.fn().mockResolvedValue({ token: 'ghs_abc123' })
    const mockApp = { octokit: { auth: mockAuth } }
    const { getInstallationToken } = await import('./github-auth.js')
    const result = await getInstallationToken(mockApp as any, 42)
    expect(mockAuth).toHaveBeenCalledWith({ type: 'installation', installationId: 42 })
    expect(result).toBe('ghs_abc123')
  })
})
