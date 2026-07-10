import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('getConfig', () => {
  const original = { ...process.env }

  beforeEach(() => {
    process.env.GITHUB_APP_ID = '12345'
    process.env.GITHUB_PRIVATE_KEY =
      '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n'
    process.env.GITHUB_WEBHOOK_SECRET = 'mysecret'
    process.env.PORT = '3000'
  })

  afterEach(() => {
    Object.assign(process.env, original)
    vi.resetModules()
  })

  it('returns config when all env vars are set', async () => {
    const { getConfig } = await import('./config.js')
    const cfg = getConfig()
    expect(cfg.appId).toBe(12345)
    expect(cfg.webhookSecret).toBe('mysecret')
    expect(cfg.port).toBe(3000)
  })

  it('throws when GITHUB_APP_ID is missing', async () => {
    delete process.env.GITHUB_APP_ID
    const { getConfig } = await import('./config.js')
    expect(() => getConfig()).toThrow(/GITHUB_APP_ID/)
  })

  it('throws when GITHUB_WEBHOOK_SECRET is missing', async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET
    const { getConfig } = await import('./config.js')
    expect(() => getConfig()).toThrow(/GITHUB_WEBHOOK_SECRET/)
  })
})
