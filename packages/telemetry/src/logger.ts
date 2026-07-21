// pino ships an `export =` CJS type (the outer `declare namespace pino`
// carries LoggerOptions/Logger/DestinationStream/stdTimeFunctions), so a
// default import is required to access those types — the brief's named
// `import { pino }` only resolves to the inner CJS-destructure shim, which
// lacks these type members (tsc TS2694 under this repo's pino@10.3.1 types).
import pino from 'pino'
import { PINO_REDACT_PATHS, REDACTED, scrubLogValue } from './redaction.js'

export interface CreateLoggerOptions {
  level?: string
  /** Test seam: capture output in-memory. Defaults to stdout. */
  destination?: pino.DestinationStream
}

/**
 * Structured logger factory (spec §3: "Real libraries: pino"). Redaction is
 * applied at log-creation time — secrets never reach ANY sink (console, file,
 * or the OTLP bridge). Two layers, matching the Python censor_processor's
 * key+value scrubbing (§5 parity): pino's own `redact.paths` blanks
 * blocklisted KEY paths outright; `formatters.log` (below) additionally
 * pattern-scrubs secret-SHAPED substrings out of every string value (and
 * `err.message`/`err.stack`) so a stray `sk-ant-…` embedded in free text —
 * not just a blocklisted key — never reaches a sink. trace_id/span_id
 * stamping + OTLP log shipping are
 * added transparently by @opentelemetry/instrumentation-pino when
 * initTelemetry() ran in this process; without it this is a plain JSON
 * console logger (telemetry-off degradation, never a crash).
 *
 * Convention (§5 / §10): the old `[tag]` console prefixes become a structured
 * `component` field — always derive per-module loggers via
 * `logger.child({ component: 'worker' })`.
 */
export function createLogger(service: string, opts: CreateLoggerOptions = {}): pino.Logger {
  const options: pino.LoggerOptions = {
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    base: { service },
    redact: { paths: [...PINO_REDACT_PATHS], censor: REDACTED },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Runs before pino's own `err` serializer and before `redact` — see the
    // module doc comment above and scrubLogValue's doc in redaction.ts.
    formatters: {
      log(mergeObject) {
        // Fail CLOSED, and never throw. This runs inside the caller's
        // `catch (err) { log.error(...) }`, so anything escaping here converts
        // a handled error into an unhandled one and can fail a whole review
        // (§3: telemetry must never take the app down). If scrubbing itself
        // breaks we drop the payload rather than emit a possibly-unscrubbed
        // one — a lost log line is recoverable, a leaked credential is not.
        try {
          return scrubLogValue(mergeObject) as Record<string, unknown>
        } catch {
          return { scrubError: 'log payload dropped: scrubbing failed' }
        }
      },
    },
  }
  return opts.destination ? pino(options, opts.destination) : pino(options)
}
