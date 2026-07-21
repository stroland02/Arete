export {
  REDACT_KEYS,
  SECRET_VALUE_PATTERNS,
  REDACTED,
  scrubText,
  stripUrlQuery,
  PINO_REDACT_PATHS,
} from './redaction.js'
export { ScrubbingSpanProcessor } from './scrub-processor.js'
export { buildResource, type AreteServiceName } from './resource.js'
export {
  initTelemetry,
  shutdownTelemetry,
  registerEsmHook,
  DURATION_HISTOGRAM_BOUNDARIES,
} from './init.js'
export { createLogger, type CreateLoggerOptions } from './logger.js'
