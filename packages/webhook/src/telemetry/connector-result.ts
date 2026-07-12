import type { TelemetrySnapshot } from '../types.js'

/**
 * Result contract shared by every telemetry connector. Distinguishes a
 * provider that answered with nothing to report ('no-data' — e.g. a repo
 * with zero workflow runs, a PostHog project with no recent events) from a
 * real provider failure ('error' — rate limit, auth failure, timeout,
 * network error). The circuit breaker in fetch-telemetry-context.ts must
 * only ever count 'error' — a healthy provider with legitimately empty
 * results can never open the circuit.
 */
export type ConnectorResult =
  | { status: 'ok'; snapshot: TelemetrySnapshot }
  | { status: 'no-data' }
  | { status: 'error' }
