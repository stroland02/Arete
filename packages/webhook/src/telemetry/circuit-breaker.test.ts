import { webhookFetch } from '@arete/net-guard'
vi.mock('@arete/net-guard', () => ({ webhookFetch: vi.fn() }))
const webhookFetchMock = vi.mocked(webhookFetch)
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('telemetry circuit breaker', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
  })

  it('is closed (allows calls) with no recorded failures', async () => {
    const { isTelemetryCircuitOpen } = await import('./circuit-breaker.js')
    expect(isTelemetryCircuitOpen('posthog')).toBe(false)
  })

  it('opens after 5 consecutive failures for a provider', async () => {
    const { recordTelemetryFailure, isTelemetryCircuitOpen } = await import('./circuit-breaker.js')
    for (let i = 0; i < 5; i++) recordTelemetryFailure('posthog')
    expect(isTelemetryCircuitOpen('posthog')).toBe(true)
  })

  it('does not open a different provider\'s circuit', async () => {
    const { recordTelemetryFailure, isTelemetryCircuitOpen } = await import('./circuit-breaker.js')
    for (let i = 0; i < 5; i++) recordTelemetryFailure('posthog')
    expect(isTelemetryCircuitOpen('github_actions')).toBe(false)
  })

  it('a success resets the failure count', async () => {
    const { recordTelemetryFailure, recordTelemetrySuccess, isTelemetryCircuitOpen } = await import('./circuit-breaker.js')
    for (let i = 0; i < 4; i++) recordTelemetryFailure('posthog')
    recordTelemetrySuccess('posthog')
    recordTelemetryFailure('posthog')
    expect(isTelemetryCircuitOpen('posthog')).toBe(false)
  })

  it('closes again after the 5-minute cooldown elapses', async () => {
    const { recordTelemetryFailure, isTelemetryCircuitOpen } = await import('./circuit-breaker.js')
    for (let i = 0; i < 5; i++) recordTelemetryFailure('posthog')
    expect(isTelemetryCircuitOpen('posthog')).toBe(true)
    vi.setSystemTime(new Date('2026-07-10T00:05:01Z'))
    expect(isTelemetryCircuitOpen('posthog')).toBe(false)
  })
})

