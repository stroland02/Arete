/**
 * The service name of THIS process, as a plain string.
 *
 * `initTelemetry(serviceName, ...)` already puts it on the OTel Resource, but
 * a Resource is not readable from ordinary application code — and the emit-time
 * issue fingerprint (record-exception.ts) needs the *same* string the read-time
 * path groups on, which is the `ServiceName` column ClickHouse fills from that
 * resource attribute. So the bootstrap records it here as well, and the
 * fingerprint helper reads it from here.
 *
 * A module-level variable is correct rather than lazy: exactly one
 * `initTelemetry` call happens per process (webhook `src/otel.ts` →
 * `arete-webhook`, worker `src/otel-worker.ts` → `arete-worker`), from an
 * `--import` boot file, before any application module resolves.
 */

let current: string | null = null

/** Called once by `initTelemetry`. First call wins, mirroring the SDK's own
 *  "first init wins" behaviour — a second call cannot silently repartition
 *  fingerprints mid-process. */
export function setServiceName(name: string): void {
  if (current === null) current = name
}

/**
 * The process's service name, or `''` when telemetry was never initialized.
 *
 * `OTEL_SERVICE_NAME` is honoured as a fallback because it is the standard
 * env-var the SDK itself would read; `''` (rather than a guess like
 * 'unknown_service') is the last resort, so an un-bootstrapped process
 * produces an obviously-unscoped fingerprint rather than one that looks
 * legitimate and silently merges every service together under a made-up name.
 */
export function currentServiceName(): string {
  return current ?? process.env.OTEL_SERVICE_NAME ?? ''
}

/** Test/shutdown hook — clears the recorded name so a fresh `initTelemetry`
 *  can set it again. Not part of the runtime contract. */
export function resetServiceName(): void {
  current = null
}
