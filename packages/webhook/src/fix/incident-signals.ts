// Runtime context for a healing run — the last unshipped bullet of obs spec §3
// Phase 2 ("telemetry-fed investigations"), deferred at the time for one stated
// reason: there was no internal query surface to read. There is now.
//
// THE GAP THIS CLOSES. An alert fires, the receiver opens an Incident, Task 4's
// routing opens a WorkItem, and the fix pipeline authors a patch — having read
// the repository and the work item's static code evidence, and nothing else.
// The error spans, logs and exceptions that *are* the incident never reached
// the agent asked to fix it. The dashboard's Signals panel shows a human that
// context; this hands the same context to the healing agent, from the same
// single gated implementation in @arete/db (see .claude/ade-coordination.md).
//
// SCOPE, STATED PLAINLY BECAUSE IT OTHERWISE READS AS A BUG. The platform gate
// means this only ever returns signals for the platform installation — Kuma
// healing Kuma. That is not a shortcut; nothing ingests customer telemetry
// until Phase 3, so for a customer incident there is genuinely nothing to read.
// The three outcomes stay distinguishable all the way to the prompt
// (`availability`), because "you may not look" and "the backend is down" must
// never reach an LLM as "there was nothing wrong" — that is the tenancy
// contract's §4 lie, and an agent that believes it will author a confident
// patch for a problem it never saw.
//
// NEVER THROWS (Global Constraint 3: telemetry must not take the app down). By
// the time this runs, a fix drive has already minted a GitHub token and is
// about to check out a repository. A ClickHouse outage degrades the fix to the
// evidence it had before; it does not fail it.

import {
  getIncidentSignals,
  incidentSignalWindow,
  type IncidentSignals,
  type SignalWindow,
  type TelemetryQueriesDb,
} from '@arete/db/telemetry'
import { logger } from '../logger.js'

const log = logger.child({ component: 'fix-signals' })

// Prompt budget. The dashboard's limits (50 spans / 100 logs / 20 exceptions)
// are sized for a human scrolling a page; an LLM context is not, and every row
// here competes with the repository evidence that actually locates the bug.
// Kept deliberately small, with the drop count reported alongside — a silent
// cap reads as "this is everything", and an agent would reason accordingly.
export const MAX_SIGNAL_SPANS = 10
export const MAX_SIGNAL_LOGS = 20
export const MAX_SIGNAL_EXCEPTIONS = 10
export const MAX_LOG_BODY_CHARS = 500

/** Why the signal lists are the way they are. Three states, never collapsed:
 *  `denied` (not the platform installation — nothing was queried), `unavailable`
 *  (the gate passed but the telemetry backend could not answer), `granted`
 *  (we looked; empty lists mean the window really was quiet). */
export type FixSignalAvailability = 'granted' | 'denied' | 'unavailable'

export interface FixSignalSpan {
  timestamp: string
  service: string
  spanName: string
  traceId: string
  statusMessage: string
  durationMs: number
}

export interface FixSignalLog {
  timestamp: string
  service: string
  severity: string
  body: string
  traceId: string
}

export interface FixSignalException {
  exceptionType: string
  exceptionMessage: string
  service: string
  occurrences: number
  lastSeen: string
}

/**
 * The incident context handed to the fix agent. Timestamps are ISO strings, not
 * `Date`s: this crosses an HTTP boundary into Pydantic (`models/fix.py`), and a
 * `Date` would serialise inconsistently depending on who called `JSON.stringify`.
 */
export interface FixIncidentSignals {
  incidentId: string
  alertName: string
  severity: string
  status: string
  summary: string
  startsAt: string
  resolvedAt: string | null
  /** The service the alert named, if any. Null widens the read to every service. */
  service: string | null
  availability: FixSignalAvailability
  spans: FixSignalSpan[]
  logs: FixSignalLog[]
  exceptions: FixSignalException[]
  /** How many rows the caps dropped, per kind. Zero when nothing was dropped. */
  omitted: { spans: number; logs: number; exceptions: number }
}

/** Only the Prisma surface this needs, structurally — so tests inject a fake
 *  and the caller passes the real client, the convention the rest of `fix/`
 *  already uses (see trigger.ts's FixTriggerDeps). */
export interface CollectFixSignalsDeps {
  prisma: {
    incident: {
      findFirst(args: {
        where: { workItemId: string; installationId: string }
        select?: unknown
      }): Promise<{
        id: string
        alertName: string
        severity: string
        status: string
        summary: string
        payload: unknown
        startsAt: Date
        resolvedAt: Date | null
      } | null>
    }
  }
  /** Passed to the platform gate inside `getSignals`. */
  db: TelemetryQueriesDb
  getSignals: (
    db: TelemetryQueriesDb,
    installationIds: string[],
    window: SignalWindow,
    service?: string
  ) => Promise<IncidentSignals>
}

/**
 * The service the alert is about, read from its labels.
 *
 * Prometheus convention is `service`, falling back to `job` — the same
 * derivation the incident detail page uses, deliberately, so the agent scopes
 * its telemetry to exactly what a human reviewing the same incident sees.
 * Null widens the read to every service in the window rather than returning
 * nothing, which is the right failure: a broad answer beats none.
 */
function serviceLabelOf(payload: unknown): string | null {
  const labels = (payload as { labels?: Record<string, unknown> } | null)?.labels
  if (!labels) return null
  const service = labels.service ?? labels.job
  return typeof service === 'string' && service.length > 0 ? service : null
}

/** Truncates visibly. A clipped body that looks complete invites the agent to
 *  quote it as if it read the whole line. */
function truncateBody(body: string): string {
  return body.length > MAX_LOG_BODY_CHARS ? `${body.slice(0, MAX_LOG_BODY_CHARS)}…` : body
}

/** The empty-signal shapes, so the reason for emptiness is always carried
 *  explicitly rather than defaulted into by an early return. */
function noSignals(
  base: Omit<FixIncidentSignals, 'availability' | 'spans' | 'logs' | 'exceptions' | 'omitted'>,
  availability: FixSignalAvailability
): FixIncidentSignals {
  return {
    ...base,
    availability,
    spans: [],
    logs: [],
    exceptions: [],
    omitted: { spans: 0, logs: 0, exceptions: 0 },
  }
}

/**
 * Gathers the runtime context around the incident that opened this work item,
 * or `null` when no incident did — the common case, a scan-born work item,
 * which costs one indexed lookup and no telemetry query at all.
 *
 * The lookup is scoped by installation as well as work item. `Incident.workItemId`
 * is a denormalized field with no Prisma relation behind it (see the schema
 * comment, and cooldown.ts's note on the same pattern), so nothing structural
 * stops a lookup from crossing tenants; the scope has to be in the `where`.
 */
export async function collectFixSignals(
  deps: CollectFixSignalsDeps,
  params: { workItemId: string; installationId: string }
): Promise<FixIncidentSignals | null> {
  const { workItemId, installationId } = params

  let incident
  try {
    incident = await deps.prisma.incident.findFirst({
      where: { workItemId, installationId },
    })
  } catch (err) {
    // Degrade to "no incident context" rather than failing the drive.
    log.warn({ err, workItemId }, 'incident lookup failed — driving the fix without signals')
    return null
  }

  if (!incident) return null

  const service = serviceLabelOf(incident.payload)
  const window = incidentSignalWindow(incident.startsAt, incident.resolvedAt)

  const base = {
    incidentId: incident.id,
    alertName: incident.alertName,
    severity: incident.severity,
    status: incident.status,
    summary: incident.summary,
    startsAt: incident.startsAt.toISOString(),
    resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
    service,
  }

  let signals: IncidentSignals
  try {
    signals = await deps.getSignals(deps.db, [installationId], window, service ?? undefined)
  } catch (err) {
    log.warn(
      { err, incidentId: incident.id },
      'telemetry read failed — fix proceeds without signals'
    )
    return noSignals(base, 'unavailable')
  }

  // Denied is checked first and reported on its own: the gate refusing means
  // ClickHouse was never contacted, so `unavailable` — a claim about the
  // backend's health — would be something we are in no position to assert.
  if (signals.access === 'denied') return noSignals(base, 'denied')

  const spans = signals.spans.slice(0, MAX_SIGNAL_SPANS).map((s) => ({
    timestamp: s.timestamp.toISOString(),
    service: s.service,
    spanName: s.spanName,
    traceId: s.traceId,
    statusMessage: s.statusMessage,
    durationMs: s.durationMs,
  }))
  const logs = signals.logs.slice(0, MAX_SIGNAL_LOGS).map((l) => ({
    timestamp: l.timestamp.toISOString(),
    service: l.service,
    severity: l.severity,
    body: truncateBody(l.body),
    traceId: l.traceId,
  }))
  const exceptions = signals.exceptions.slice(0, MAX_SIGNAL_EXCEPTIONS).map((e) => ({
    exceptionType: e.exceptionType,
    exceptionMessage: e.exceptionMessage,
    service: e.service,
    occurrences: e.occurrences,
    lastSeen: e.lastSeen.toISOString(),
  }))

  return {
    ...base,
    availability: signals.unavailable ? 'unavailable' : 'granted',
    spans,
    logs,
    exceptions,
    omitted: {
      spans: signals.spans.length - spans.length,
      logs: signals.logs.length - logs.length,
      exceptions: signals.exceptions.length - exceptions.length,
    },
  }
}

/** The production wiring: the real platform-gated reads from @arete/db. Kept
 *  beside the collector so a caller cannot accidentally assemble it with an
 *  ungated reader. */
export const defaultSignalReader = getIncidentSignals
