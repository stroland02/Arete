import { registerOTel } from '@vercel/otel'

/**
 * Next.js instrumentation hook (stable — runs once per server boot in each
 * runtime). @vercel/otel reads OTEL_EXPORTER_OTLP_ENDPOINT and friends from
 * the environment; conventions/redaction are shared with @arete/telemetry by
 * config only (spec decision: the dashboard deliberately does NOT load the
 * NodeSDK — auto-instrumentations don't survive Next bundling).
 * Telemetry must never take the dashboard down (spec §3).
 */
export function register(): void {
  try {
    registerOTel({
      serviceName: 'arete-dashboard',
      attributes: {
        'deployment.environment.name': process.env.DEPLOYMENT_ENVIRONMENT ?? 'development',
      },
    })
  } catch (err) {
    // The one permitted warning — same contract as @arete/telemetry init.
    // (packages/dashboard's eslint config does not enforce no-console the
    // way packages/webhook's does, so no disable directive is needed here.)
    console.warn(`[telemetry] dashboard init failed — running without telemetry: ${err instanceof Error ? err.message : String(err)}`)
  }
}
