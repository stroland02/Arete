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
    if (process.env.OTEL_SDK_DISABLED === 'true') return
    // Shared seam with @arete/telemetry init.ts: unset endpoint is a graceful
    // no-op, never a localhost default. @vercel/otel falls back to
    // http://localhost:4318/v1/traces when OTEL_EXPORTER_OTLP_ENDPOINT (and
    // its _TRACES_ variant) are unset, so that fallback must be guarded
    // against explicitly here.
    if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      console.warn('[telemetry] OTEL_EXPORTER_OTLP_ENDPOINT is not set; running without telemetry')
      return
    }
    registerOTel({
      serviceName: 'arete-dashboard',
      attributes: {
        'deployment.environment.name': process.env.DEPLOYMENT_ENVIRONMENT ?? 'development',
        // Self-dogfooding tenancy — mirrors @arete/telemetry resource.ts: when
        // ARETE_SELF_PROJECT_ID is set, stamp the dashboard's own spans with
        // that superlog.project_id so they are visible under that tenant. OFF
        // by default; never point at a real customer tenant in prod.
        ...(process.env.ARETE_SELF_PROJECT_ID
          ? { 'superlog.project_id': process.env.ARETE_SELF_PROJECT_ID }
          : {}),
      },
    })
  } catch (err) {
    // The one permitted warning — same contract as @arete/telemetry init.
    // (packages/dashboard's eslint config does not enforce no-console the
    // way packages/webhook's does, so no disable directive is needed here.)
    console.warn(`[telemetry] dashboard init failed — running without telemetry: ${err instanceof Error ? err.message : String(err)}`)
  }
}
