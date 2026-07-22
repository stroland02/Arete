import { clickhouse } from './clickhouse';

// Internal telemetry query surface — reads Areté's OWN SUPERLOG observability
// data (otel_traces / otel_logs / otel_exceptions in ClickHouse) for a single
// incident, so the Incident detail page can show the real trace/log/exception
// context around an alert. This is dogfooding: our services emit the telemetry,
// our dashboard reads it back. (Distinct from telemetry/fetch-telemetry-context
// on the webhook side, which pulls a *customer's* external providers — PostHog,
// Sentry, Vercel — for PR review.)
//
// SECURITY — tenant isolation is the non-negotiable invariant of every query
// here: each read filters `superlog.project_id IN (installationIds)`, where
// installationIds is the caller's session-authorized set (the same set that
// fetched the incident). project_id maps to Areté's installationId. Values are
// ALWAYS passed via ClickHouse bound parameters ({name: Type} + query_params),
// never string-interpolated — installation ids and the alert's service label
// are caller-influenced. A missing tenant filter would be a cross-tenant leak.

/** The time span we pull signals for, bracketing the incident's lifetime. */
export interface SignalWindow {
  start: Date;
  end: Date;
}

export interface ErrorSpan {
  timestamp: Date;
  service: string;
  spanName: string;
  traceId: string;
  statusMessage: string;
  durationMs: number;
}

export interface LogLine {
  timestamp: Date;
  service: string;
  severity: string;
  body: string;
  traceId: string;
}

export interface ExceptionGroup {
  exceptionType: string;
  exceptionMessage: string;
  service: string;
  occurrences: number;
  lastSeen: Date;
}

/** All three signal kinds for an incident, plus whether the telemetry backend
 *  could be reached. `unavailable` is true when any read errored (ClickHouse
 *  down or unconfigured) — the page renders a soft "signals unavailable" note
 *  rather than 500ing, since a telemetry gap must never break the incident. */
export interface IncidentSignals {
  spans: ErrorSpan[];
  logs: LogLine[];
  exceptions: ExceptionGroup[];
  unavailable: boolean;
}

const PRE_WINDOW_MS = 15 * 60_000; // look back 15 min before the alert fired
const POST_WINDOW_MS = 15 * 60_000; // and 15 min forward when still firing
const MAX_WINDOW_MS = 24 * 60 * 60_000; // cap the scan span at 24h

// SeverityNumber >= 17 is ERROR+ in the OTel severity scale — matches how
// 004_otel_exceptions.sql defines a log-shaped exception.
const DEFAULT_MIN_SEVERITY = 17;

const SPAN_LIMIT = 50;
const LOG_LIMIT = 100;
const EXCEPTION_LIMIT = 20;

/**
 * Derives the signal window from an incident's timestamps: from 15 min before
 * it started to either its resolution or 15 min after it started (still
 * firing), capped at MAX_WINDOW_MS so a long-lived incident can't uncap the
 * scan.
 */
export function incidentSignalWindow(
  startsAt: string | Date,
  resolvedAt: string | Date | null
): SignalWindow {
  const startedMs = new Date(startsAt).getTime();
  const start = new Date(startedMs - PRE_WINDOW_MS);
  const rawEnd = resolvedAt ? new Date(resolvedAt).getTime() : startedMs + POST_WINDOW_MS;
  const end = new Date(Math.min(rawEnd, start.getTime() + MAX_WINDOW_MS));
  return { start, end };
}

/** Bound time-window params shared by every query — epoch millis as Int64 so
 *  ClickHouse's `fromUnixTimestamp64Milli` reconstructs the DateTime with no
 *  timezone/parsing ambiguity, and the caller data stays out of the SQL text. */
function windowParams(window: SignalWindow): { startMs: number; endMs: number } {
  return { startMs: window.start.getTime(), endMs: window.end.getTime() };
}

/**
 * Recent error spans (StatusCode = ERROR) for the incident window, newest
 * first. Duration is nanoseconds in ClickHouse; surfaced as milliseconds.
 */
export async function getIncidentErrorSpans(
  installationIds: string[],
  window: SignalWindow,
  service?: string
): Promise<ErrorSpan[]> {
  if (installationIds.length === 0) return [];

  const result = await clickhouse.query({
    query: `
      SELECT
        Timestamp AS timestamp,
        ServiceName AS service,
        SpanName AS spanName,
        TraceId AS traceId,
        StatusMessage AS statusMessage,
        Duration AS durationNs
      FROM superlog.otel_traces
      WHERE ResourceAttributes['superlog.project_id'] IN ({installationIds: Array(String)})
        -- The ClickHouse OTel exporter stores the short status name ('Error'),
        -- not the proto enum ('STATUS_CODE_ERROR'); match both so the filter
        -- survives an exporter/config that emits either form. (Verified against
        -- the live collector, which emits 'Error'.)
        AND StatusCode IN ('Error', 'STATUS_CODE_ERROR')
        AND Timestamp >= fromUnixTimestamp64Milli({startMs: Int64})
        AND Timestamp <= fromUnixTimestamp64Milli({endMs: Int64})
        ${service ? "AND ServiceName = {service: String}" : ""}
      ORDER BY Timestamp DESC
      LIMIT {limit: UInt32}
    `,
    query_params: {
      installationIds,
      ...windowParams(window),
      ...(service ? { service } : {}),
      limit: SPAN_LIMIT,
    },
    format: 'JSONEachRow',
  });

  const rows: Array<{
    timestamp: string;
    service: string;
    spanName: string;
    traceId: string;
    statusMessage: string;
    durationNs: string;
  }> = await result.json();

  return rows.map((r) => ({
    timestamp: new Date(r.timestamp),
    service: r.service,
    spanName: r.spanName,
    traceId: r.traceId,
    statusMessage: r.statusMessage,
    durationMs: Number(r.durationNs) / 1e6,
  }));
}

/**
 * Recent logs at or above ERROR severity for the incident window, newest
 * first. Bodies are already scrubbed at ingest (obs spec §5/§6) — never
 * re-widen capture here.
 */
export async function getIncidentLogs(
  installationIds: string[],
  window: SignalWindow,
  service?: string,
  minSeverity: number = DEFAULT_MIN_SEVERITY
): Promise<LogLine[]> {
  if (installationIds.length === 0) return [];

  const result = await clickhouse.query({
    query: `
      SELECT
        Timestamp AS timestamp,
        ServiceName AS service,
        SeverityText AS severity,
        Body AS body,
        TraceId AS traceId
      FROM superlog.otel_logs
      WHERE ResourceAttributes['superlog.project_id'] IN ({installationIds: Array(String)})
        AND SeverityNumber >= {minSeverity: UInt8}
        AND Timestamp >= fromUnixTimestamp64Milli({startMs: Int64})
        AND Timestamp <= fromUnixTimestamp64Milli({endMs: Int64})
        ${service ? "AND ServiceName = {service: String}" : ""}
      ORDER BY Timestamp DESC
      LIMIT {limit: UInt32}
    `,
    query_params: {
      installationIds,
      ...windowParams(window),
      minSeverity: Math.max(0, Math.min(255, Math.floor(minSeverity))),
      ...(service ? { service } : {}),
      limit: LOG_LIMIT,
    },
    format: 'JSONEachRow',
  });

  const rows: Array<{
    timestamp: string;
    service: string;
    severity: string;
    body: string;
    traceId: string;
  }> = await result.json();

  return rows.map((r) => ({
    timestamp: new Date(r.timestamp),
    service: r.service,
    severity: r.severity,
    body: r.body,
    traceId: r.traceId,
  }));
}

/**
 * Exceptions in the incident window, grouped by (type, message, service) with
 * an occurrence count and last-seen time — most frequent first. Reads the
 * purpose-built otel_exceptions projection (its own project_id column), not an
 * ARRAY JOIN scan of otel_traces.
 */
export async function getIncidentExceptions(
  installationIds: string[],
  window: SignalWindow,
  service?: string
): Promise<ExceptionGroup[]> {
  if (installationIds.length === 0) return [];

  const result = await clickhouse.query({
    query: `
      SELECT
        exception_type AS exceptionType,
        exception_message AS exceptionMessage,
        service,
        count() AS occurrences,
        max(Timestamp) AS lastSeen
      FROM superlog.otel_exceptions
      WHERE project_id IN ({installationIds: Array(String)})
        AND Timestamp >= fromUnixTimestamp64Milli({startMs: Int64})
        AND Timestamp <= fromUnixTimestamp64Milli({endMs: Int64})
        ${service ? "AND service = {service: String}" : ""}
      GROUP BY exceptionType, exceptionMessage, service
      ORDER BY occurrences DESC, lastSeen DESC
      LIMIT {limit: UInt32}
    `,
    query_params: {
      installationIds,
      ...windowParams(window),
      ...(service ? { service } : {}),
      limit: EXCEPTION_LIMIT,
    },
    format: 'JSONEachRow',
  });

  const rows: Array<{
    exceptionType: string;
    exceptionMessage: string;
    service: string;
    occurrences: string;
    lastSeen: string;
  }> = await result.json();

  return rows.map((r) => ({
    exceptionType: r.exceptionType,
    exceptionMessage: r.exceptionMessage,
    service: r.service,
    occurrences: Number(r.occurrences),
    lastSeen: new Date(r.lastSeen),
  }));
}

/**
 * Convenience aggregate for the Incident detail page: all three signal kinds
 * in parallel, fail-soft. A telemetry-backend outage (ClickHouse down or
 * unconfigured) resolves to empty lists + `unavailable: true` rather than
 * throwing, so the incident page always renders. An empty tenant set returns
 * empty + available (nothing to show is not an error).
 */
export async function getIncidentSignals(
  installationIds: string[],
  window: SignalWindow,
  service?: string
): Promise<IncidentSignals> {
  if (installationIds.length === 0) {
    return { spans: [], logs: [], exceptions: [], unavailable: false };
  }

  const [spans, logs, exceptions] = await Promise.allSettled([
    getIncidentErrorSpans(installationIds, window, service),
    getIncidentLogs(installationIds, window, service),
    getIncidentExceptions(installationIds, window, service),
  ]);

  const unavailable =
    spans.status === 'rejected' ||
    logs.status === 'rejected' ||
    exceptions.status === 'rejected';

  return {
    spans: spans.status === 'fulfilled' ? spans.value : [],
    logs: logs.status === 'fulfilled' ? logs.value : [],
    exceptions: exceptions.status === 'fulfilled' ? exceptions.value : [],
    unavailable,
  };
}
