import { register } from 'node:module'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { PeriodicExportingMetricReader, AggregationType } from '@opentelemetry/sdk-metrics'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { buildResource, type AreteServiceName } from './resource.js'
import { ScrubbingSpanProcessor } from './scrub-processor.js'
import { resetServiceName, setServiceName } from './service-name.js'

/** §5 frozen: review/agent durations bucketed up to 300 s — the default 10 s
 *  ceiling silently corrupts p95/p99 exactly where LLM latency lives. */
export const DURATION_HISTOGRAM_BOUNDARIES = [1, 2, 5, 10, 30, 60, 120, 180, 300]

let sdk: NodeSDK | null = null
let started = false

/**
 * Env-driven OTel bootstrap. Loaded from a dedicated init file via
 * `node --import` / `tsx --import` BEFORE any app code (ESM; --require is
 * for CJS builds and does not apply here — webhook is "type": "module").
 *
 * MUST NEVER take the app down (spec §3): fully try/catch-wrapped, logs
 * exactly one warning on failure, returns whether telemetry is live.
 */
export function initTelemetry(serviceName: AreteServiceName, serviceVersion = '0.1.0'): boolean {
  if (started) return sdk !== null
  started = true
  // Record the process's service name even on the paths that return early
  // below: `recordExceptionWithFingerprint` scopes its issue fingerprint by
  // service name, and a span emitted through a manually-registered provider
  // (tests, or a future non-SDK bootstrap) must still be scoped correctly.
  // Not derived from the Resource — a Resource is not readable from app code.
  setServiceName(serviceName)
  if (process.env.OTEL_SDK_DISABLED === 'true') return false
  try {
    // JS SDK emits legacy http semconv until v3; http/dup bridges (spec §4).
    process.env.OTEL_SEMCONV_STABILITY_OPT_IN ??= 'http/dup'
    // Shared seam with Lane B (arete_agents/observability.py): unset endpoint
    // is a graceful no-op, never a localhost default.
    const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim().replace(/\/$/, '')
    if (!endpoint) {
      console.warn('[telemetry] OTEL_EXPORTER_OTLP_ENDPOINT is not set; running without telemetry')
      return false
    }

    sdk = new NodeSDK({
      resource: buildResource(serviceName, serviceVersion),
      spanProcessors: [
        new ScrubbingSpanProcessor(), // scrub BEFORE export — order matters
        new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })),
      ],
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 10_000,
      }),
      logRecordProcessors: [
        new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }) }),
      ],
      views: [
        {
          instrumentName: 'arete.review.duration',
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: { boundaries: DURATION_HISTOGRAM_BOUNDARIES },
          },
        },
        {
          instrumentName: 'arete.agent.duration',
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: { boundaries: DURATION_HISTOGRAM_BOUNDARIES },
          },
        },
      ],
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs spans are pure noise for a webhook service
          '@opentelemetry/instrumentation-fs': { enabled: false },
          // ioredis: suppress BullMQ blocking-poll noise (spec §4) — brpoplpush
          // etc. produce a span per poll tick otherwise.
          '@opentelemetry/instrumentation-ioredis': {
            requireParentSpan: true,
          },
          // pino: trace_id/span_id stamping + OTLP log bridge
          '@opentelemetry/instrumentation-pino': { enabled: true },
        }),
      ],
    })
    sdk.start()
    return true
  } catch (err) {
    sdk = null
    // The ONE permitted bare console call (spec §3: "failure logs one warning
    // and the service runs without telemetry").
    console.warn(`[telemetry] init failed — running without telemetry: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

export async function shutdownTelemetry(): Promise<void> {
  const s = sdk
  sdk = null
  started = false
  resetServiceName() // so a subsequent initTelemetry() can set it again
  if (!s) return
  try {
    await s.shutdown()
  } catch {
    // shutdown failures are never fatal
  }
}

/**
 * Registers the import-in-the-middle ESM loader hook so pure-ESM packages
 * (@octokit/*) can be instrumented. CJS deps (express, ioredis, pino, bullmq)
 * are patched via require-in-the-middle regardless. Call this FIRST in the
 * boot file, before initTelemetry. Safe no-op on failure.
 */
export function registerEsmHook(): void {
  try {
    register('import-in-the-middle/hook.mjs', import.meta.url)
  } catch {
    // Hook unavailable — manual spans and CJS auto-instrumentation still work.
  }
}
