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

describe('getStripeConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns undefined fields when Stripe env vars are unset', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', undefined)
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', undefined)
    const { getStripeConfig } = await import('./config.js')
    const cfg = getStripeConfig()
    expect(cfg.secretKey).toBeUndefined()
    expect(cfg.webhookSecret).toBeUndefined()
  })

  it('returns configured values when set', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_123')
    const { getStripeConfig } = await import('./config.js')
    const cfg = getStripeConfig()
    expect(cfg.secretKey).toBe('sk_test_123')
    expect(cfg.webhookSecret).toBe('whsec_123')
  })
})

describe('getGitLabConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults accessToken to empty string and url to gitlab.com', async () => {
    vi.stubEnv('GITLAB_ACCESS_TOKEN', undefined)
    vi.stubEnv('GITLAB_URL', undefined)
    vi.stubEnv('GITLAB_WEBHOOK_SECRET', undefined)
    const { getGitLabConfig } = await import('./config.js')
    const cfg = getGitLabConfig()
    expect(cfg.accessToken).toBe('')
    expect(cfg.url).toBe('https://gitlab.com')
    expect(cfg.webhookSecret).toBeUndefined()
  })

  it('respects an overridden GITLAB_URL for self-hosted instances', async () => {
    vi.stubEnv('GITLAB_URL', 'https://gitlab.example.com')
    const { getGitLabConfig } = await import('./config.js')
    expect(getGitLabConfig().url).toBe('https://gitlab.example.com')
  })

  it('falls back to the default when GITLAB_URL is an empty string', async () => {
    vi.stubEnv('GITLAB_URL', '')
    const { getGitLabConfig } = await import('./config.js')
    expect(getGitLabConfig().url).toBe('https://gitlab.com')
  })
})

describe('getServiceConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to local dev URLs matching infra/docker-compose.yml', async () => {
    vi.stubEnv('PYTHON_SERVICE_URL', undefined)
    vi.stubEnv('DATABASE_URL', undefined)
    const { getServiceConfig } = await import('./config.js')
    const cfg = getServiceConfig()
    expect(cfg.pythonServiceUrl).toBe('http://127.0.0.1:8000')
    expect(cfg.databaseUrl).toBe('postgresql://arete:arete@localhost:5432/arete')
  })

  it('respects overridden values', async () => {
    vi.stubEnv('PYTHON_SERVICE_URL', 'http://agents:8000')
    vi.stubEnv('DATABASE_URL', 'postgresql://u:p@db:5432/arete')
    const { getServiceConfig } = await import('./config.js')
    const cfg = getServiceConfig()
    expect(cfg.pythonServiceUrl).toBe('http://agents:8000')
    expect(cfg.databaseUrl).toBe('postgresql://u:p@db:5432/arete')
  })
})
