import { webhookFetch } from '@arete/net-guard'
vi.mock('@arete/net-guard', () => ({ webhookFetch: vi.fn() }))
const webhookFetchMock = vi.mocked(webhookFetch)
import { describe, it, expect } from 'vitest'
import { assertAllowedTelemetryHost } from './ssrf-guard.js'

describe('assertAllowedTelemetryHost', () => {
  it('allows the posthog hosted API host', () => {
    expect(() => assertAllowedTelemetryHost('posthog', 'https://app.posthog.com/api/projects/1/query')).not.toThrow()
  })

  it('allows the github api host', () => {
    expect(() => assertAllowedTelemetryHost('github_actions', 'https://api.github.com/repos/acme/api/actions/runs')).not.toThrow()
  })

  it('rejects a customer-supplied non-allowlisted host', () => {
    expect(() => assertAllowedTelemetryHost('posthog', 'https://evil.example.com/api')).toThrow(/not an allowed host/)
  })

  it('rejects an attempt to reach the cloud metadata endpoint', () => {
    expect(() => assertAllowedTelemetryHost('posthog', 'http://169.254.169.254/latest/meta-data/')).toThrow()
  })

  it('rejects an attempt to reach localhost', () => {
    expect(() => assertAllowedTelemetryHost('posthog', 'http://127.0.0.1:8000/internal')).toThrow()
  })

  it('rejects an attempt to reach a private RFC-1918 address', () => {
    expect(() => assertAllowedTelemetryHost('posthog', 'http://10.0.0.5/internal')).toThrow()
  })

  it('rejects the wrong provider for a given host', () => {
    expect(() => assertAllowedTelemetryHost('github_actions', 'https://app.posthog.com/api/projects/1/query')).toThrow(/not an allowed host/)
  })

  it('allows the sentry api host', () => {
    expect(() => assertAllowedTelemetryHost('sentry', 'https://sentry.io/api/0/organizations/acme/issues/')).not.toThrow()
  })

  it('allows the vercel api host', () => {
    expect(() => assertAllowedTelemetryHost('vercel', 'https://api.vercel.com/v6/deployments')).not.toThrow()
  })

  it('allows the stripe api host', () => {
    expect(() => assertAllowedTelemetryHost('stripe', 'https://api.stripe.com/v1/charges')).not.toThrow()
  })

  it('rejects sentry provider for a vercel host', () => {
    expect(() => assertAllowedTelemetryHost('sentry', 'https://api.vercel.com/v6/deployments')).toThrow(/not an allowed host/)
  })
})

