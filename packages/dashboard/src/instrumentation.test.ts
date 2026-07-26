import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const registerOTel = vi.fn()
vi.mock('@vercel/otel', () => ({
  registerOTel: (...args: unknown[]) => registerOTel(...args),
}))

import { register } from './instrumentation'

describe('instrumentation register()', () => {
  beforeEach(() => {
    vi.stubEnv('OTEL_SDK_DISABLED', '')
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '')
    registerOTel.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does NOT call registerOTel when OTEL_EXPORTER_OTLP_ENDPOINT is unset (no localhost default)', () => {
    register()
    expect(registerOTel).not.toHaveBeenCalled()
  })

  it('does NOT call registerOTel when OTEL_SDK_DISABLED=true, even with an endpoint set', () => {
    vi.stubEnv('OTEL_SDK_DISABLED', 'true')
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://collector:4318')
    register()
    expect(registerOTel).not.toHaveBeenCalled()
  })

  it('calls registerOTel once with serviceName "arete-dashboard" when an endpoint is set', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://collector:4318')
    register()
    expect(registerOTel).toHaveBeenCalledTimes(1)
    expect(registerOTel).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'arete-dashboard' })
    )
  })
})
