import { describe, it, expect, afterEach, vi } from 'vitest'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { buildResource } from './resource.js'
import { initTelemetry, shutdownTelemetry, DURATION_HISTOGRAM_BOUNDARIES } from './init.js'

describe('buildResource (§5 resource attributes)', () => {
  it('stamps the four frozen resource attributes', () => {
    const resource = buildResource('arete-worker', '0.1.0')
    expect(resource.attributes[ATTR_SERVICE_NAME]).toBe('arete-worker')
    expect(resource.attributes[ATTR_SERVICE_VERSION]).toBe('0.1.0')
    expect(resource.attributes['deployment.environment.name']).toBe('development')
    expect(resource.attributes['service.instance.id']).toBeTruthy()
  })

  it('deployment.environment.name honors the env override', () => {
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', 'production')
    const resource = buildResource('arete-webhook', '0.1.0')
    expect(resource.attributes['deployment.environment.name']).toBe('production')
    vi.unstubAllEnvs()
  })

  it('leaves superlog.project_id unset when ARETE_SELF_PROJECT_ID is unset', () => {
    vi.stubEnv('ARETE_SELF_PROJECT_ID', '')
    const resource = buildResource('arete-worker', '0.1.0')
    expect(resource.attributes['superlog.project_id']).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('stamps superlog.project_id for self-dogfooding when ARETE_SELF_PROJECT_ID is set', () => {
    vi.stubEnv('ARETE_SELF_PROJECT_ID', '11111111-1111-4111-8111-111111111111')
    const resource = buildResource('arete-worker', '0.1.0')
    expect(resource.attributes['superlog.project_id']).toBe('11111111-1111-4111-8111-111111111111')
    vi.unstubAllEnvs()
  })
})

describe('initTelemetry (never crashes the app — spec §3)', () => {
  afterEach(async () => {
    await shutdownTelemetry()
    vi.unstubAllEnvs()
  })

  it('returns false and does not throw when OTEL_SDK_DISABLED=true', () => {
    vi.stubEnv('OTEL_SDK_DISABLED', 'true')
    expect(initTelemetry('arete-webhook')).toBe(false)
  })

  // Shared seam with Lane B: unset endpoint => graceful no-op, NOT a
  // localhost default. Exporting at a collector that isn't running makes
  // every dev/CI run retry and log. Both lanes must agree here.
  it('returns false when OTEL_EXPORTER_OTLP_ENDPOINT is unset', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '')
    expect(initTelemetry('arete-webhook')).toBe(false)
  })

  it('does not throw even with a garbage endpoint; second call is an idempotent no-op', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:1')
    let result: boolean | undefined
    expect(() => { result = initTelemetry('arete-webhook') }).not.toThrow()
    expect(typeof result).toBe('boolean')
    expect(initTelemetry('arete-webhook')).toBe(result)
  })

  it('defaults OTEL_SEMCONV_STABILITY_OPT_IN to http/dup', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:1')
    initTelemetry('arete-webhook')
    expect(process.env.OTEL_SEMCONV_STABILITY_OPT_IN).toBe('http/dup')
  })
})

describe('histogram boundaries (§5 — 300s ceiling)', () => {
  it('is the frozen 9-bucket list', () => {
    expect(DURATION_HISTOGRAM_BOUNDARIES).toEqual([1, 2, 5, 10, 30, 60, 120, 180, 300])
  })
})
