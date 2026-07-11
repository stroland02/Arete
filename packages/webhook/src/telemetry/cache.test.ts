import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TelemetrySnapshot } from '../types.js'

const SNAPSHOT: TelemetrySnapshot = {
  provider: 'posthog',
  source_ref: 'production-app',
  summary_text: 'x',
  metrics: {},
  links: [],
  fetched_at: '2026-07-10T00:00:00Z',
}

describe('telemetry cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
  })

  it('returns null for an uncached key', async () => {
    const { getCachedTelemetry } = await import('./cache.js')
    expect(getCachedTelemetry('inst-1', 'posthog', 'production-app')).toBeNull()
  })

  it('returns a cached snapshot within the TTL', async () => {
    const { getCachedTelemetry, setCachedTelemetry } = await import('./cache.js')
    setCachedTelemetry('inst-1', 'posthog', 'production-app', SNAPSHOT)
    expect(getCachedTelemetry('inst-1', 'posthog', 'production-app')).toEqual(SNAPSHOT)
  })

  it('does not leak across different installations for the same provider/source_ref', async () => {
    const { getCachedTelemetry, setCachedTelemetry } = await import('./cache.js')
    setCachedTelemetry('inst-1', 'posthog', 'production-app', SNAPSHOT)
    expect(getCachedTelemetry('inst-2', 'posthog', 'production-app')).toBeNull()
  })

  it('expires after the 15-minute TTL', async () => {
    const { getCachedTelemetry, setCachedTelemetry } = await import('./cache.js')
    setCachedTelemetry('inst-1', 'posthog', 'production-app', SNAPSHOT)
    vi.setSystemTime(new Date('2026-07-10T00:15:01Z'))
    expect(getCachedTelemetry('inst-1', 'posthog', 'production-app')).toBeNull()
  })
})
