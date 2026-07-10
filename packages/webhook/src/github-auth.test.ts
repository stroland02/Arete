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
