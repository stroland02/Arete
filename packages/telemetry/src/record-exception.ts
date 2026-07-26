import { type Attributes, type Exception, type Span, type TimeInput } from '@opentelemetry/api'
import {
  ATTR_EXCEPTION_MESSAGE,
  ATTR_EXCEPTION_STACKTRACE,
  ATTR_EXCEPTION_TYPE,
} from '@opentelemetry/semantic-conventions'
import { fingerprintError } from './fingerprint.js'
import { scrubText } from './redaction.js'
import { currentServiceName } from './service-name.js'

/**
 * Emit-time issue grouping key, stamped on the `exception` span event.
 *
 * Read by BOTH ClickHouse projections that claim to group issues:
 * `superlog.otel_exceptions` (`event_attrs['superlog.issue_fingerprint']`,
 * migration 004) and `superlog.issue_activity_daily` (migration 002), which is
 * *keyed* by fingerprint and therefore cannot group at all while nothing
 * stamps this. Nothing did, before this module.
 */
export const ISSUE_FINGERPRINT_ATTR = 'superlog.issue_fingerprint'

/** The OTel-spec name of the exception span event. The
 *  `otel_exceptions_from_traces_mv` materialized view selects on exactly this
 *  string (`WHERE event_name = 'exception'`), so it is not ours to rename. */
const EXCEPTION_EVENT_NAME = 'exception'

export interface RecordExceptionOptions {
  /**
   * Overrides the scope of the fingerprint. Defaults to this process's own
   * `service.name` (see service-name.ts) because that is the value ClickHouse
   * stores as `ServiceName`, and the read-time path groups on it.
   * Pass this only when recording an exception on behalf of another service.
   */
  service?: string
  /** Forwarded to `addEvent`, exactly as `Span.recordException`'s second
   *  argument is. Omit for "now". */
  time?: TimeInput
}

interface ExceptionLike {
  code?: string | number
  name?: string
  message?: string
  stack?: string
}

/**
 * `span.recordException(exception)` PLUS the `superlog.issue_fingerprint`
 * attribute — the emit-time half of contract §5's "one fingerprint, one
 * normalizer" (docs/superpowers/specs/2026-07-22-telemetry-tenancy-contract.md).
 *
 * WHY THIS EXISTS AT ALL, i.e. why not just call `recordException`: the OTel
 * API's `Span.recordException(exception, time)` takes **no attributes
 * argument**. There is no way to attach `superlog.issue_fingerprint` to the
 * event it creates. So this reproduces the SDK's own attribute construction
 * (`@opentelemetry/sdk-trace` Span.recordException: `exception.type` from
 * `code ?? name`, `exception.message`, `exception.stacktrace`, and the
 * "type or message must be present" minimum) and adds one key. The event
 * emitted is otherwise the same event, under the same name, so every existing
 * consumer — Jaeger, the collector, the scrub processor, the two materialized
 * views — sees what it saw before.
 *
 * THE MESSAGE IS SCRUBBED BEFORE HASHING, deliberately. `ScrubbingSpanProcessor`
 * rewrites every string event attribute with `scrubText` on span end, so what
 * actually reaches ClickHouse — and therefore what the dashboard's read-time
 * `fingerprintError(service, message)` sees — is the scrubbed text. Hashing the
 * raw text here would produce a key that disagrees with the read path for
 * exactly those messages that contained a secret. `scrubText` is idempotent, so
 * the later pass over this event changes nothing.
 *
 * NEVER THROWS. Telemetry must not be what turns a real failure into a second
 * one (spec §3), and every call site is inside a `catch` that is about to
 * rethrow the original error. On any internal failure this falls back to the
 * plain `span.recordException`, so the worst case is the pre-existing
 * behaviour: an unfingerprinted exception event.
 *
 * A non-recording span (`NonRecordingSpan`, i.e. no SDK registered or the span
 * is not sampled) no-ops in `addEvent` exactly as it no-ops in
 * `recordException` — this adds no work and no observable difference there.
 */
export function recordExceptionWithFingerprint(
  span: Span,
  exception: Exception,
  options: RecordExceptionOptions = {}
): void {
  try {
    const attributes: Attributes = {}
    if (typeof exception === 'string') {
      attributes[ATTR_EXCEPTION_MESSAGE] = exception
    } else if (exception) {
      const e = exception as ExceptionLike
      if (e.code) {
        attributes[ATTR_EXCEPTION_TYPE] = e.code.toString()
      } else if (e.name) {
        attributes[ATTR_EXCEPTION_TYPE] = e.name
      }
      if (e.message) {
        attributes[ATTR_EXCEPTION_MESSAGE] = e.message
      }
      if (e.stack) {
        attributes[ATTR_EXCEPTION_STACKTRACE] = e.stack
      }
    }

    // The SDK's own minimum requirement. When it is not met the SDK records
    // NOTHING and logs a diag warning; delegating keeps that behaviour (and
    // its warning) instead of inventing an event the SDK would have refused.
    if (!attributes[ATTR_EXCEPTION_TYPE] && !attributes[ATTR_EXCEPTION_MESSAGE]) {
      span.recordException(exception, options.time)
      return
    }

    // Only the HASH INPUT is scrubbed here; the recorded `exception.message` is
    // left exactly as `recordException` would have recorded it, so this helper
    // adds one attribute and changes nothing else. `ScrubbingSpanProcessor`
    // still scrubs the message itself on span end, as it always did.
    const rawMessage = attributes[ATTR_EXCEPTION_MESSAGE]
    const message = typeof rawMessage === 'string' ? scrubText(rawMessage) : ''
    attributes[ISSUE_FINGERPRINT_ATTR] = fingerprintError(options.service ?? currentServiceName(), message)

    span.addEvent(EXCEPTION_EVENT_NAME, attributes, options.time)
  } catch {
    try {
      span.recordException(exception, options.time)
    } catch {
      // Nothing left to do: recording telemetry must never surface an error of
      // its own onto the failure path that called us.
    }
  }
}
