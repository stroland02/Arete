// The Errors surface: individual error occurrences, grouped by what they ARE,
// and the link between those groups and the Incidents that resolve them.
//
// The user's framing (verbatim): "let's combine both of these where it looks
// like the errors is like a list of each individual error and then the
// incidence is like the groupings of these errors that can be resolved all at
// once so in our incidence page let's also create an errors page which shows
// which incidents are connected to which errors".
//
// WHERE THE DATA LIVES
// --------------------
// Error EVENTS are in ClickHouse (`superlog.otel_traces` errored spans and
// `superlog.otel_logs` error-severity records), NOT Postgres. Postgres holds
// only the human triage state — one `ErrorGroup` row per fingerprint, carrying
// status and the incident attachment. A group with no row is "open" by
// definition, so the common case costs nothing to write.
//
// TENANCY — READ THIS BEFORE ADDING A CALLER
// -----------------------------------------
// ClickHouse here holds Kuma's OWN self-telemetry. There is no tenant column
// in `otel_traces`/`otel_logs` and there is nothing to filter on, so this
// surface can only ever be shown to the PLATFORM installation — the same
// dedicated, platform-owned Installation the Alertmanager receiver files every
// incident against (`ARETE_PLATFORM_INSTALLATION_ID`, see
// packages/webhook/src/alerting/receiver.ts and .env.example: "a DEDICATED,
// PLATFORM-OWNED Installation, NEVER a customer's"). Every read and every
// write below is gated on `isPlatformInstallation` FIRST. A customer account
// must never see Kuma's internal errors.
//
// The reads return `null` — not `[]` — when the gate fails. An empty list
// reads as "you have no errors", which is a lie; `null` says "this surface is
// not available for this account" and lets the UI say so honestly.

import type { PrismaClient } from '@arete/db';
import { clickhouse } from './clickhouse';
import { fingerprintError } from './error-fingerprint';
import { bucketByDay } from './trends';

export type ErrorStatus = 'open' | 'observing' | 'resolved' | 'silenced';

export const ERROR_STATUSES: readonly ErrorStatus[] = [
  'open',
  'observing',
  'resolved',
  'silenced',
] as const;

export function isErrorStatus(value: unknown): value is ErrorStatus {
  return typeof value === 'string' && (ERROR_STATUSES as readonly string[]).includes(value);
}

export interface ErrorGroupView {
  fingerprint: string;
  /** "exception" = an errored span from otel_traces; "log" = an error-severity
   *  record from otel_logs. It names the SIGNAL the group was built from. */
  kind: 'exception' | 'log';
  service: string;
  /** Concise label: the exception type when the span carried one, else the
   *  span name (for logs: the exception type, else the first line of Body). */
  title: string;
  /** The full message, truncated to MAX_MESSAGE chars. '' when the source
   *  carried no message at all — never invented. */
  message: string;
  eventCount: number;
  firstSeen: string; // ISO
  lastSeen: string; // ISO
  /** Per-day counts, oldest -> newest, length === the requested `days`. */
  dailyCounts: number[];
  sampleTraceId: string | null;
  /** From the ErrorGroup row; "open" when no row exists yet. */
  status: ErrorStatus;
  incidentId: string | null;
  incidentAlertName: string | null;
}

export interface IncidentErrorGroups {
  attached: ErrorGroupView[];
  correlated: ErrorGroupView[];
}

/** Prisma delegates the reads use — structural, so tests inject fakes and the
 *  page passes the real client (the lib/ convention, see incidents.ts). */
export type ErrorGroupsDb = {
  errorGroup: { findMany(args: unknown): Promise<unknown[]> };
  incident: { findMany(args: unknown): Promise<unknown[]> };
};

export type IncidentErrorGroupsDb = ErrorGroupsDb & {
  incident: {
    findMany(args: unknown): Promise<unknown[]>;
    findFirst(args: unknown): Promise<unknown | null>;
  };
};

export type ErrorMutationsDb = {
  errorGroup: {
    upsert(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  incident: {
    findFirst(args: unknown): Promise<unknown | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

/** Default trailing window for the Errors list. */
const DEFAULT_DAYS = 14;

/** Both otel_* tables carry a 30-day TTL — asking for more than that returns
 *  the same rows while pretending to a longer history, so the window is capped
 *  here rather than silently lying in the chart. */
const MAX_DAYS = 30;

/** Hard row ceiling per ClickHouse query. These are RAW event rows (one per
 *  errored span / error log), grouped in TS afterwards, so the cost is bounded
 *  by this number and not by however many errors the platform is emitting. At
 *  the current volume (192 error spans over the whole retention window) this is
 *  ~25x headroom; if it is ever hit, the oldest events in the window are the
 *  ones dropped (ORDER BY Timestamp DESC), so recency stays correct. */
const MAX_ROWS = 5000;

const MAX_MESSAGE = 500;

/** Longest first-line-of-Body we will use as a log group's title. */
const MAX_LOG_TITLE = 120;

/**
 * True iff `ARETE_PLATFORM_INSTALLATION_ID` is configured AND the caller is
 * authorized for it. This is the ONLY gate protecting Kuma's internal
 * telemetry from customer accounts — see the module header.
 *
 * Unset env => false for everyone, including the platform's own operators.
 * That is deliberate and matches the receiver: an unconfigured platform
 * installation makes the feature inert rather than making it leak.
 */
export function isPlatformInstallation(installationIds: string[]): boolean {
  return platformInstallationId(installationIds) !== null;
}

/** The configured platform installation id, but only when the caller is
 *  actually authorized for it. Writes use this as the row's installationId, so
 *  a row can never be created against an installation the caller lacks. */
function platformInstallationId(installationIds: string[]): string | null {
  const configured = process.env.ARETE_PLATFORM_INSTALLATION_ID;
  if (typeof configured !== 'string' || configured.trim().length === 0) return null;
  const platformId = configured.trim();
  return installationIds.includes(platformId) ? platformId : null;
}

function clampDays(days: number | undefined): number {
  const raw = Math.floor(days ?? DEFAULT_DAYS);
  if (!Number.isFinite(raw)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, raw));
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** One raw error occurrence, normalized across the span and log sources. */
interface RawErrorEvent {
  ts: string; // ISO, UTC
  traceId: string;
  service: string;
  kind: 'exception' | 'log';
  title: string;
  message: string;
}

interface SpanRow {
  ts: string;
  traceId: string;
  service: string;
  spanName: string;
  statusMessage: string;
  excType: string;
  excMessage: string;
}

interface LogRow {
  ts: string;
  traceId: string;
  service: string;
  body: string;
  excType: string;
}

/**
 * ClickHouse failures fail SOFT — logged, then treated as "no events from this
 * source" — mirroring sensorium.ts's `.catch(() => [])`. A degraded telemetry
 * backend must never throw a 500 into the page; a partially-populated Errors
 * list is strictly better than an error page, and the operator sees the cause
 * in the server log.
 *
 * Only the error MESSAGE is logged, never the error object: the ClickHouse
 * client attaches connection config to some failures and that config carries
 * CLICKHOUSE_PASSWORD.
 */
function softFail<T>(source: string): (err: unknown) => T[] {
  return (err: unknown) => {
    console.error(
      `[errors] ClickHouse ${source} query failed; continuing without it: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return [];
  };
}

/**
 * Errored spans in the trailing window.
 *
 * An OTel exception is recorded as a span EVENT, so `exception.type` /
 * `exception.message` live in the parallel `Events.*` arrays rather than in a
 * column. `arrayFirst` over the mapped attributes picks the first event that
 * actually carries one and yields '' when none do — which is the honest
 * answer, and the caller then falls back to StatusMessage and finally to the
 * span name. Nothing is invented.
 *
 * Timestamps are formatted to explicit ISO-8601 UTC in SQL: the raw
 * DateTime64(9) renders as a naive '2026-07-21 15:34:33.077000000' that
 * JavaScript's Date parses as LOCAL time (or not at all), which would shift
 * every day bucket by the server's UTC offset.
 *
 * The format string is '%FT%TZ', not '%Y-%m-%dT%H:%M:%SZ' — in ClickHouse
 * `%M` is the full MONTH NAME (that spelling yields '2026-07-21T21:July:31Z');
 * minutes are `%i`. `%F`/`%T` avoid the trap entirely.
 */
async function fetchErrorSpans(days: number): Promise<SpanRow[]> {
  const result = await clickhouse.query({
    query: `
      SELECT
        formatDateTime(Timestamp, '%FT%TZ', 'UTC') AS ts,
        TraceId AS traceId,
        ServiceName AS service,
        SpanName AS spanName,
        StatusMessage AS statusMessage,
        arrayFirst(x -> x != '', arrayMap(a -> a['exception.type'], \`Events.Attributes\`)) AS excType,
        arrayFirst(x -> x != '', arrayMap(a -> a['exception.message'], \`Events.Attributes\`)) AS excMessage
      FROM superlog.otel_traces
      WHERE StatusCode = 'Error'
        AND Timestamp >= subtractDays(now('UTC'), {days: UInt32})
      ORDER BY Timestamp DESC
      LIMIT {maxRows: UInt32}
    `,
    query_params: { days, maxRows: MAX_ROWS },
    format: 'JSONEachRow',
  });
  return (await result.json()) as SpanRow[];
}

/**
 * Error-severity log records in the trailing window. OTel severity numbers:
 * 17-20 is ERROR, 21-24 is FATAL — so `>= 17` is "error or worse". The current
 * local sample contains only INFO(9) and WARN(13), so this legitimately
 * returns nothing today; that is a real empty result, not a broken query.
 */
async function fetchErrorLogs(days: number): Promise<LogRow[]> {
  const result = await clickhouse.query({
    query: `
      SELECT
        formatDateTime(Timestamp, '%FT%TZ', 'UTC') AS ts,
        TraceId AS traceId,
        ServiceName AS service,
        Body AS body,
        LogAttributes['exception.type'] AS excType
      FROM superlog.otel_logs
      WHERE SeverityNumber >= 17
        AND Timestamp >= subtractDays(now('UTC'), {days: UInt32})
      ORDER BY Timestamp DESC
      LIMIT {maxRows: UInt32}
    `,
    query_params: { days, maxRows: MAX_ROWS },
    format: 'JSONEachRow',
  });
  return (await result.json()) as LogRow[];
}

function spanToEvent(r: SpanRow): RawErrorEvent {
  const excType = (r.excType ?? '').trim();
  const spanName = (r.spanName ?? '').trim();
  // Contract order: exception type, else span name. A generic type like
  // "Error" is still preferred over the span name — the frozen contract says
  // "exception type, or span name", and `message` carries the detail.
  const title = excType || spanName;
  // Contract order for the body: exception.message, else StatusMessage, else
  // nothing. A group whose source carried no message keeps '' — the span name
  // is already the title and duplicating it as a message would fabricate one.
  const message = (r.excMessage ?? '').trim() || (r.statusMessage ?? '').trim();
  return {
    ts: r.ts,
    traceId: r.traceId ?? '',
    service: r.service ?? '',
    kind: 'exception',
    title,
    message: truncate(message, MAX_MESSAGE),
  };
}

function logToEvent(r: LogRow): RawErrorEvent {
  const body = (r.body ?? '').trim();
  const excType = (r.excType ?? '').trim();
  // No span name exists for a log record, so the concise label is the
  // exception type when the emitter attached one, else the first line of the
  // body (bounded) — a slice of the real text, never a synthesized summary.
  const firstLine = body.split('\n', 1)[0] ?? '';
  const title = excType || truncate(firstLine, MAX_LOG_TITLE);
  return {
    ts: r.ts,
    traceId: r.traceId ?? '',
    service: r.service ?? '',
    kind: 'log',
    title,
    message: truncate(body, MAX_MESSAGE),
  };
}

interface Accumulator {
  fingerprint: string;
  kind: 'exception' | 'log';
  service: string;
  title: string;
  message: string;
  timestamps: Date[];
  firstSeen: number;
  lastSeen: number;
  sampleTraceId: string | null;
}

/**
 * Collapse raw occurrences into groups keyed by `fingerprintError`.
 *
 * The fingerprint is taken over `message || title`, NOT the message alone.
 * Plenty of real errored spans carry no message whatsoever (locally:
 * arete-worker's `tcp.connect`, 158 events, and `POST`, 3 events) and keying
 * those on '' would fuse every messageless failure in a service into one
 * meaningless bucket labelled by whichever arrived first. Falling back to the
 * title keeps them apart while leaving every message-bearing error grouped
 * exactly as `fingerprintError(service, message)` would group it.
 */
function groupEvents(events: RawErrorEvent[], days: number): Omit<
  ErrorGroupView,
  'status' | 'incidentId' | 'incidentAlertName'
>[] {
  const groups = new Map<string, Accumulator>();

  for (const e of events) {
    const at = new Date(e.ts);
    if (Number.isNaN(at.getTime())) continue; // unparseable timestamp: drop, never guess
    const fingerprint = fingerprintError(e.service, e.message || e.title);
    const existing = groups.get(fingerprint);
    if (!existing) {
      groups.set(fingerprint, {
        fingerprint,
        kind: e.kind,
        service: e.service,
        title: e.title,
        message: e.message,
        timestamps: [at],
        firstSeen: at.getTime(),
        lastSeen: at.getTime(),
        sampleTraceId: e.traceId || null,
      });
      continue;
    }
    existing.timestamps.push(at);
    if (at.getTime() < existing.firstSeen) existing.firstSeen = at.getTime();
    if (at.getTime() > existing.lastSeen) {
      existing.lastSeen = at.getTime();
      // Keep the trace id of the most RECENT occurrence — that is the one an
      // operator wants to open, and it is the one still in Jaeger's window.
      if (e.traceId) existing.sampleTraceId = e.traceId;
    }
    if (!existing.sampleTraceId && e.traceId) existing.sampleTraceId = e.traceId;
  }

  return [...groups.values()].map((g) => ({
    fingerprint: g.fingerprint,
    kind: g.kind,
    service: g.service,
    title: g.title,
    message: g.message,
    eventCount: g.timestamps.length,
    firstSeen: new Date(g.firstSeen).toISOString(),
    lastSeen: new Date(g.lastSeen).toISOString(),
    dailyCounts: bucketByDay(g.timestamps, days),
    sampleTraceId: g.sampleTraceId,
  }));
}

/**
 * The Errors list: every distinct error observed in the trailing window,
 * newest-active first, carrying its triage status and incident link.
 *
 * Returns `null` when the caller is not the platform installation — see the
 * module header. Never returns `[]` for that case.
 *
 * Groups are built from ClickHouse EVENTS, then LEFT-joined to the Postgres
 * `ErrorGroup` rows by fingerprint (scoped to `installationIds`). A fingerprint
 * with no row is `status: "open"` with no incident. The join is one-directional
 * on purpose: an `ErrorGroup` row whose events have aged out of the 30-day TTL
 * has nothing observable left to show, so it does not appear.
 */
export async function getErrorGroups(
  db: ErrorGroupsDb | PrismaClient,
  installationIds: string[],
  opts?: { days?: number },
): Promise<ErrorGroupView[] | null> {
  if (!isPlatformInstallation(installationIds)) return null;

  const days = clampDays(opts?.days);

  const [spans, logs] = await Promise.all([
    fetchErrorSpans(days).catch(softFail<SpanRow>('error-span')),
    fetchErrorLogs(days).catch(softFail<LogRow>('error-log')),
  ]);

  const events: RawErrorEvent[] = [
    ...spans.map(spanToEvent),
    ...logs.map(logToEvent),
  ];

  const grouped = groupEvents(events, days);
  if (grouped.length === 0) return [];

  return decorateWithTriage(db as ErrorGroupsDb, installationIds, grouped);
}

/**
 * LEFT-join the observed groups onto their Postgres triage rows.
 *
 * Both lookups pin `installationId: { in: installationIds }`, the same shape
 * every other read in lib/ uses — a row belonging to an installation outside
 * the caller's list can never be joined in, which also means a stale
 * `incidentId` pointing at another tenant's incident resolves to a null
 * alertName rather than leaking its name.
 */
async function decorateWithTriage(
  db: ErrorGroupsDb,
  installationIds: string[],
  grouped: Omit<ErrorGroupView, 'status' | 'incidentId' | 'incidentAlertName'>[],
): Promise<ErrorGroupView[]> {
  const fingerprints = grouped.map((g) => g.fingerprint);

  const rows = (await db.errorGroup.findMany({
    where: {
      installationId: { in: installationIds },
      fingerprint: { in: fingerprints },
    },
    select: { fingerprint: true, status: true, incidentId: true },
  })) as Array<{ fingerprint: string; status: string; incidentId: string | null }>;

  const byFingerprint = new Map(rows.map((r) => [r.fingerprint, r]));

  const incidentIds = [
    ...new Set(
      rows
        .map((r) => r.incidentId)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];

  const alertNameById = new Map<string, string>();
  if (incidentIds.length > 0) {
    const incidents = (await db.incident.findMany({
      where: { id: { in: incidentIds }, installationId: { in: installationIds } },
      select: { id: true, alertName: true },
    })) as Array<{ id: string; alertName: string }>;
    for (const inc of incidents) alertNameById.set(inc.id, inc.alertName);
  }

  const views = grouped.map((g) => {
    const row = byFingerprint.get(g.fingerprint);
    const status: ErrorStatus = isErrorStatus(row?.status) ? row.status : 'open';
    const incidentId = row?.incidentId ?? null;
    return {
      ...g,
      status,
      incidentId,
      incidentAlertName: incidentId ? alertNameById.get(incidentId) ?? null : null,
    };
  });

  views.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  return views;
}

/**
 * The two error lists an incident page shows:
 *
 * - `attached` — errors a human deliberately linked to this incident. These
 *   are what "resolved all at once" operates on (resolveIncidentWithErrors).
 * - `correlated` — errors that were merely HAPPENING during the incident's
 *   window `[startsAt, resolvedAt ?? now]` and are not already attached.
 *   These are candidates, not conclusions: co-occurrence is a hint, and the
 *   UI must not present them as caused by the incident.
 *
 * Returns `null` when the caller is not the platform installation. Returns
 * EMPTY lists (not null) for an incident id that is missing or belongs to
 * another installation — the same query shape as incidents.ts, so a
 * cross-tenant probe cannot distinguish "not yours" from "doesn't exist".
 *
 * The ClickHouse window is widened to cover the incident's start when the
 * incident predates the default 14 days, capped at the 30-day TTL. An attached
 * error whose events have aged out past that TTL has no observable data left
 * and will not appear in either list.
 */
export async function getIncidentErrorGroups(
  db: IncidentErrorGroupsDb | PrismaClient,
  installationIds: string[],
  incidentId: string,
): Promise<IncidentErrorGroups | null> {
  if (!isPlatformInstallation(installationIds)) return null;

  const incident = (await (db as IncidentErrorGroupsDb).incident.findFirst({
    where: { id: incidentId, installationId: { in: installationIds } },
    select: { id: true, startsAt: true, resolvedAt: true },
  })) as { id: string; startsAt: Date; resolvedAt: Date | null } | null;

  if (!incident) return { attached: [], correlated: [] };

  const startsAt = new Date(incident.startsAt).getTime();
  const endsAt = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : Date.now();

  const dayMs = 24 * 60 * 60 * 1000;
  const daysSinceStart = Math.ceil((Date.now() - startsAt) / dayMs) + 1;
  const days = clampDays(Math.max(DEFAULT_DAYS, daysSinceStart));

  const all = await getErrorGroups(db as ErrorGroupsDb, installationIds, { days });
  if (all === null) return null;

  const attached = all.filter((g) => g.incidentId === incidentId);
  const correlated = all.filter((g) => {
    if (g.incidentId === incidentId) return false;
    // Interval overlap: the group was active at some point inside the
    // incident's window. Endpoints are inclusive — an error whose only
    // occurrence is the instant the alert fired is exactly the interesting one.
    const first = new Date(g.firstSeen).getTime();
    const last = new Date(g.lastSeen).getTime();
    return first <= endsAt && last >= startsAt;
  });

  return { attached, correlated };
}

/**
 * Set a group's triage status, creating the `ErrorGroup` row on first touch
 * (a group with no row is implicitly "open", so the row only needs to exist
 * once someone actually triages it).
 *
 * Tenant-scoped by construction: the row's `installationId` is the PLATFORM
 * installation id resolved from env, and only after confirming the caller is
 * authorized for it. A caller who is not the platform installation returns
 * `false` having touched nothing — indistinguishable from "no such group", and
 * unable to create a row against any installation at all.
 *
 * `resolvedAt` / `silencedAt` are kept consistent with `status`: moving back to
 * open or observing clears them rather than leaving a stale timestamp behind.
 */
export async function setErrorGroupStatus(
  db: ErrorMutationsDb | PrismaClient,
  installationIds: string[],
  fingerprint: string,
  status: ErrorStatus,
): Promise<boolean> {
  const platformId = platformInstallationId(installationIds);
  if (platformId === null) return false;
  if (!isErrorStatus(status)) return false;
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) return false;

  const now = new Date();
  const resolvedAt = status === 'resolved' ? now : null;
  const silencedAt = status === 'silenced' ? now : null;

  await (db as ErrorMutationsDb).errorGroup.upsert({
    where: { installationId_fingerprint: { installationId: platformId, fingerprint } },
    update: { status, resolvedAt, silencedAt },
    create: { installationId: platformId, fingerprint, status, resolvedAt, silencedAt },
  });
  return true;
}

/**
 * Attach a group to an incident, or detach it when `incidentId` is null.
 *
 * This is the "which incidents are connected to which errors" edge. The
 * incident is verified to belong to the caller's installations FIRST — without
 * that check a valid platform caller could still point an error at a foreign
 * incident id, which would leak that incident's existence back through
 * `incidentAlertName`. Attaching to an unknown or foreign incident returns
 * `false` and writes nothing.
 */
export async function attachErrorGroupToIncident(
  db: ErrorMutationsDb | PrismaClient,
  installationIds: string[],
  fingerprint: string,
  incidentId: string | null,
): Promise<boolean> {
  const platformId = platformInstallationId(installationIds);
  if (platformId === null) return false;
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) return false;

  if (incidentId !== null) {
    const incident = (await (db as ErrorMutationsDb).incident.findFirst({
      where: { id: incidentId, installationId: { in: installationIds } },
      select: { id: true },
    })) as { id: string } | null;
    if (!incident) return false;
  }

  await (db as ErrorMutationsDb).errorGroup.upsert({
    where: { installationId_fingerprint: { installationId: platformId, fingerprint } },
    update: { incidentId, attachedAt: incidentId ? new Date() : null },
    create: {
      installationId: platformId,
      fingerprint,
      status: 'open',
      incidentId,
      attachedAt: incidentId ? new Date() : null,
    },
  });
  return true;
}

/**
 * Resolve an incident AND every error attached to it, in one action — the
 * "groupings of these errors that can be resolved all at once" the user asked
 * for. Returns how many error groups were resolved (0 is a legitimate answer:
 * an incident with nothing attached).
 *
 * Both writes are `updateMany` pinned to `installationId: { in: installationIds }`,
 * the incidents.ts convention: an incident outside the caller's installations
 * matches zero rows and the whole call is a silent no-op returning 0. The
 * incident is updated first and the error sweep is skipped entirely when it
 * matched nothing, so a foreign incident id can never cause a write.
 */
export async function resolveIncidentWithErrors(
  db: ErrorMutationsDb | PrismaClient,
  installationIds: string[],
  incidentId: string,
): Promise<number> {
  const platformId = platformInstallationId(installationIds);
  if (platformId === null) return 0;

  const now = new Date();

  const incidentResult = (await (db as ErrorMutationsDb).incident.updateMany({
    where: { id: incidentId, installationId: { in: installationIds } },
    data: { status: 'resolved', resolvedAt: now },
  })) as { count: number };

  if (incidentResult.count === 0) return 0;

  const errorResult = (await (db as ErrorMutationsDb).errorGroup.updateMany({
    where: { incidentId, installationId: { in: installationIds } },
    data: { status: 'resolved', resolvedAt: now },
  })) as { count: number };

  return errorResult.count;
}
