import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { currentServiceName, setServiceName, resetServiceName } from './service-name.js'

describe('service-name (the scope of every emit-time issue fingerprint)', () => {
  beforeEach(() => {
    resetServiceName()
  })

  afterEach(() => {
    resetServiceName()
    vi.unstubAllEnvs()
  })

  it('returns what initTelemetry recorded', () => {
    setServiceName('arete-worker')
    expect(currentServiceName()).toBe('arete-worker')
  })

  it('first call wins — a later call cannot repartition fingerprints mid-process', () => {
    setServiceName('arete-webhook')
    setServiceName('arete-worker')
    expect(currentServiceName()).toBe('arete-webhook')
  })

  it('falls back to OTEL_SERVICE_NAME when telemetry was never initialized', () => {
    vi.stubEnv('OTEL_SERVICE_NAME', 'arete-dashboard')
    expect(currentServiceName()).toBe('arete-dashboard')
  })

  it('prefers the recorded name over the env var', () => {
    vi.stubEnv('OTEL_SERVICE_NAME', 'arete-dashboard')
    setServiceName('arete-worker')
    expect(currentServiceName()).toBe('arete-worker')
  })

  it("returns '' rather than guessing a name when nothing is set", () => {
    vi.stubEnv('OTEL_SERVICE_NAME', '')
    // An obviously-unscoped fingerprint is honest; a made-up 'unknown_service'
    // would look legitimate while merging every service into one bucket.
    expect(currentServiceName()).toBe('')
  })
})
