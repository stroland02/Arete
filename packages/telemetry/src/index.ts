export {
  REDACT_KEYS,
  SECRET_VALUE_PATTERNS,
  REDACTED,
  scrubText,
  scrubLogValue,
  scrubSinkText,
  scrubSinkValue,
  stripUrlQuery,
  clearUrlQuery,
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
// Contract §5 ("one fingerprint, one normalizer"). Also published as the
// dependency-free `@arete/telemetry/fingerprint` subpath, which is what a
// bundled consumer (the Next.js dashboard) must import — this barrel pulls in
// the whole Node SDK bootstrap.
export { normalizeErrorMessage, fingerprintScoped, fingerprintError } from './fingerprint.js'
export {
  recordExceptionWithFingerprint,
  ISSUE_FINGERPRINT_ATTR,
  type RecordExceptionOptions,
} from './record-exception.js'
export { currentServiceName } from './service-name.js'
