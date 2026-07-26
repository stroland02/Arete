import { createLogger } from '@arete/telemetry'

/**
 * Process-wide pino logger. service.name on OTLP records comes from the SDK
 * resource (arete-webhook vs arete-worker per boot file); this base field is
 * for local console/file output. trace_id/span_id are stamped automatically
 * by instrumentation-pino whenever a span is active.
 *
 * Convention: per-module child loggers carry the old [tag] as `component`:
 *   const log = logger.child({ component: 'worker' })
 */
export const logger = createLogger('webhook')
