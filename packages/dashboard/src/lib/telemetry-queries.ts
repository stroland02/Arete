// Internal telemetry query surface — reads Areté's OWN SUPERLOG observability
// data (otel_traces / otel_logs / otel_exceptions in ClickHouse) for a single
// incident, so the Incident detail page can show the real trace/log/exception
// context around an alert. This is dogfooding: our services emit the telemetry,
// our dashboard reads it back. (Distinct from telemetry/fetch-telemetry-context
// on the webhook side, which pulls a *customer's* external providers — PostHog,
// Sentry, Vercel — for PR review.)
//
// ACCESS — WHAT `superlog.project_id` ACTUALLY IS (read before adding a caller)
// ---------------------------------------------------------------------------
// This header used to claim that "tenant isolation is the non-negotiable
// invariant of every query here", on the grounds that every read filters
// `superlog.project_id IN (installationIds)`. That claim was FALSE, and a false
// security claim is worse than no claim: it reads as an access control while
// providing none, so nobody goes looking for the real one.
//
// `superlog.project_id` is NOT tenant data. Nothing ingests customer telemetry
// yet — tenant OTLP ingest is Phase 3 and deliberately deferred
// (docs/roadmap/2026-07-15-superlog-phased-roadmap.md). Every row in these
// tables is emitted by Kuma's own services. The column carries
// `ARETE_SELF_PROJECT_ID` (stamped in packages/telemetry/src/resource.ts,
// src/instrumentation.ts, arete_agents/observability.py): an OPTIONAL
// self-observability tag answering exactly one question — under which
// installation should Kuma's OWN telemetry be visible — and whose own env doc
// says never to point it at a real customer tenant. Unset, it is '' and the
// filter matches nothing at all.
//
// So, per docs/superpowers/specs/2026-07-22-telemetry-tenancy-contract.md §1/§3:
//
//   * THE ACCESS DECISION is `isPlatformInstallation(db, installationIds)` —
//     the `Installation.isPlatform` database fact resolved by
//     lib/platform-installation.ts — and every exported read below takes it
//     FIRST, before any query leaves this process. Same gate, same single
//     resolver, as lib/errors.ts. No surface re-derives "is this the platform?"
//     locally.
//   * THE `project_id` FILTER IS A PARTITIONING CONVENIENCE, never the access
//     decision. It stays: it is already the correct scope for the day §3's
//     second row activates, and a self-telemetry read should not return rows
//     stamped for a different installation. But it is not load-bearing for
//     security and must never again be described as if it were.
//
// When Phase 3 lands and `project_id` genuinely carries a tenant id, the
// contract is amended in ONE place (§3) and this header follows it — the law
// changes deliberately rather than drifting per-surface.
//
// DENIED IS NOT EMPTY, AND NEITHER IS DOWN (contract §4)
// -----------------------------------------------------
// Three outcomes, three distinct states, because an access outcome must never
// masquerade as a data outcome:
//
//   * `access: 'denied'`  — the caller is not the platform installation.
//                           NOTHING was queried; the empty lists mean "we never
//                           asked", and the UI must say so.
//   * `unavailable: true` — ClickHouse is down or unconfigured. The empty lists
//                           mean "we asked and could not hear back".
//   * neither, all empty  — the window genuinely held no signals.
//
// Collapsing the first into either of the others tells the operator a
// comforting lie. lib/errors.ts returns `null` for exactly this reason; the
// per-signal reads here do the same, and the aggregate carries `access`
// alongside `unavailable` so the page can tell the three apart.
//
// SQL SAFETY (unchanged): values are ALWAYS passed via ClickHouse bound
// parameters ({name: Type} + query_params), never string-interpolated —
// installation ids and the alert's service label are caller-influenced.

import type { PrismaClient } from '@arete/db';
import { clickhouse } from './clickhouse';
import { isPlatformInstallation, type PlatformInstallationDb } from './platform-installation';

/** The Prisma surface these reads need — only what the platform gate itself
 *  reads (`Installation.isPlatform`). Structural, so tests inject a fake and
 *  the page passes the real client, exactly as errors.ts/incidents.ts do. */
export type TelemetryQueriesDb = PlatformInstallationDb | PrismaClient;

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

/** Whether this caller may see Kuma's self-telemetry at all.
 *
 *  `'denied'` is the platform gate refusing — the caller is not the
 *  `Installation.isPlatform` installation (or none is flagged, or the flag is
 *  ambiguous, all of which fail closed). It is NOT a data outcome and NOT a
 *  backend outage: no query was issued, so the lists are empty because nothing
 *  was ever asked. Contract §4. */
export type SignalAccess = 'granted' | 'denied';

/** All three signal kinds for an incident, plus the two independent reasons the
 *  lists may be empty.
 *
 *  `access: 'denied'` — the platform gate refused; ClickHouse was never touched.
 *  `unavailable: true` — a read errored (ClickHouse down or unconfigured); the
 *  page renders a soft "signals unavailable" note rather than 500ing, since a
 *  telemetry gap must never break the incident.
 *
 *  They are separate fields rather than one enum because they are genuinely
 *  independent questions ("may you look?" / "did the backend answer?") and
 *  because a denied read never reaches the backend, so it can say nothing about
 *  its health. All three lists empty with neither flag set is the third,
 *  honest outcome: the window really held no signals. A renderer that treats
 *  denial as emptiness is the §4 bug this type exists to make unwriteable. */
export interface IncidentSignals {
  access: SignalAccess;
  spans: ErrorSpan[];
  logs: LogLine[];
  exceptions: ExceptionGroup[];
  unavailable: boolean;
}

/** The shape returned when the platform gate refuses: nothing queried, nothing
 *  known about the backend, and it says so in the type. A factory (not a shared
 *  constant) so no caller can mutate the lists out from under the next one. */
function deniedSignals(): IncidentSignals {
  return { access: 'denied', spans: [], logs: [], exceptions: [], unavailable: false };
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
 *
 * UNGATED — private on purpose. Every path into it goes through the exported
 * wrapper below or through `getIncidentSignals`, both of which take the
 * platform gate first. Keeping the SQL in a non-exported function is what makes
 * "gate before query" structurally true rather than a convention a future
 * import could quietly skip.
 */
async function queryIncidentErrorSpans(
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
 *
 * UNGATED — see `queryIncidentErrorSpans`.
 */
async function queryIncidentLogs(
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
 *
 * UNGATED — see `queryIncidentErrorSpans`.
 */
async function queryIncidentExceptions(
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
 * Error spans for the window, or `null` when the caller is not the platform
 * installation — `null`, never `[]`, because "you may not look" is not "there
 * were none" (contract §4). ClickHouse is not touched on the denied path.
 */
export async function getIncidentErrorSpans(
  db: TelemetryQueriesDb,
  installationIds: string[],
  window: SignalWindow,
  service?: string
): Promise<ErrorSpan[] | null> {
  if (!(await isPlatformInstallation(db, installationIds))) return null;
  return queryIncidentErrorSpans(installationIds, window, service);
}

/** Error-severity logs for the window, or `null` when the gate refuses. See
 *  `getIncidentErrorSpans` for why it is `null` and not `[]`. */
export async function getIncidentLogs(
  db: TelemetryQueriesDb,
  installationIds: string[],
  window: SignalWindow,
  service?: string,
  minSeverity: number = DEFAULT_MIN_SEVERITY
): Promise<LogLine[] | null> {
  if (!(await isPlatformInstallation(db, installationIds))) return null;
  return queryIncidentLogs(installationIds, window, service, minSeverity);
}

/** Grouped exceptions for the window, or `null` when the gate refuses. See
 *  `getIncidentErrorSpans` for why it is `null` and not `[]`. */
export async function getIncidentExceptions(
  db: TelemetryQueriesDb,
  installationIds: string[],
  window: SignalWindow,
  service?: string
): Promise<ExceptionGroup[] | null> {
  if (!(await isPlatformInstallation(db, installationIds))) return null;
  return queryIncidentExceptions(installationIds, window, service);
}

/**
 * Convenience aggregate for the Incident detail page: all three signal kinds in
 * parallel, fail-soft, behind ONE platform-gate check.
 *
 * The gate is taken FIRST (contract §3): a caller who is not the platform
 * installation gets `access: 'denied'` and ClickHouse is never contacted — no
 * connection, no query, no timing signal. An empty installation set lands here
 * too, because nobody is authorized for anything; it used to be reported as
 * "available but empty", which was the §4 lie in miniature.
 *
 * Past the gate, a telemetry-backend outage (ClickHouse down or unconfigured)
 * resolves to empty lists + `unavailable: true` rather than throwing, so the
 * incident page always renders. `unavailable` keeps exactly its old meaning —
 * *the backend could not be reached* — and is never used for the access
 * decision. The three private query functions are called directly so the gate
 * costs one database read per page, not four.
 */
export async function getIncidentSignals(
  db: TelemetryQueriesDb,
  installationIds: string[],
  window: SignalWindow,
  service?: string
): Promise<IncidentSignals> {
  if (!(await isPlatformInstallation(db, installationIds))) return deniedSignals();

  const [spans, logs, exceptions] = await Promise.allSettled([
    queryIncidentErrorSpans(installationIds, window, service),
    queryIncidentLogs(installationIds, window, service),
    queryIncidentExceptions(installationIds, window, service),
  ]);

  const unavailable =
    spans.status === 'rejected' ||
    logs.status === 'rejected' ||
    exceptions.status === 'rejected';

  return {
    access: 'granted',
    spans: spans.status === 'fulfilled' ? spans.value : [],
    logs: logs.status === 'fulfilled' ? logs.value : [],
    exceptions: exceptions.status === 'fulfilled' ? exceptions.value : [],
    unavailable,
  };
}
