// Alertmanager webhook receiver (Phase 2 Task 3). Alertmanager owns grouping,
// dedup, inhibition, and repeat intervals (infra/alertmanager.yml) — this
// module only records what it is told, idempotently, per
// (installationId, fingerprint) — Incident's compound unique key
// (packages/db/prisma/schema.prisma). Alertmanager re-sends a still-firing
// alert on its repeat interval, so a second delivery must UPDATE the same
// row, never open a second one.
//
// Contract (never violate): this function must NEVER throw. Alertmanager
// retries on any non-2xx response, so an uncaught exception here — from a
// malformed body, a bad label, or a transient DB error on one alert in a
// batch — must be logged and swallowed, not propagated, or a single bad
// delivery becomes an infinite retry storm. The ONLY non-2xx response on the
// wire is the internal-token auth guard in server.ts, which runs before this
// function is ever called.
//
// Payloads are attacker-adjacent free text (annotations can carry secret-
// shaped substrings or query fragments — Global Constraint 2) and are
// scrubbed with the canonical @arete/telemetry scrubber BEFORE any write,
// never a bespoke one. EVERY persisted field goes through it — the scalar
// columns (alertName, severity, fingerprint) as much as payload/summary; a
// review probe found `ghp_…` stored verbatim in `alertName` while `payload`
// showed `[REDACTED]` (finding I2).
//
// TENANCY (finding C1, fixed 2026-07-21). This receiver does NOT read tenant
// identity from the alert payload. It cannot: the body is chosen by whoever
// can reach Alertmanager, and `labels.installationId` was being taken as the
// tenancy authority — so a fabricated alert could file an incident (and, once
// Task 4 landed, OPEN A FIX RUN) against any customer, with attacker-chosen
// summary text rendered in that customer's dashboard. Every alert is now
// attributed to the ONE platform installation and `labels.installationId` is
// ignored entirely — it survives only as inert, scrubbed data inside `payload`.
// This makes tenant spoofing structurally impossible rather than merely
// validated, which is what Global Constraint 4 demands.
//
// WHICH installation that is used to be `ARETE_PLATFORM_INSTALLATION_ID`, and
// this header used to say "There is no `platform` flag on the Installation
// model to enforce this". THAT IS NO LONGER TRUE. `Installation.isPlatform`
// exists (packages/db/prisma/schema.prisma) and is the source of truth per
// docs/superpowers/specs/2026-07-22-telemetry-tenancy-contract.md §2. The env
// var closed only half the defect: it made the tenant un-spoofable BY THE
// CALLER while leaving it a string an operator can mistype into a customer's
// id — after which every platform incident, and every fix run Task 4 opens from
// one, lands in that customer's account. Resolution now goes through the ONE
// shared resolver, `@arete/db`'s platform-installation module, which the
// dashboard's telemetry gates use too; the env var survives only as a
// transitional fallback while no row carries the flag, so existing deployments
// do not go dark on upgrade. Both halves of the boundary now fail closed the
// same way, from the same code.
//
// All three shipped rules (AreteReviewErrorRate, AreteReviewLatencyP95,
// AreteQueueFailureRate) are platform-wide and carry no tenant label, so
// nothing is lost today. WHEN PER-TENANT ALERTING ARRIVES it must resolve the
// tenant through a TRUSTED SERVER-SIDE MAPPING — e.g. rule name -> owning
// installation, or a Prometheus target label the platform itself sets and the
// receiver re-verifies against the DB — and NEVER from a client-supplied
// label on the wire.

import { trace, metrics, SpanStatusCode, type Counter } from '@opentelemetry/api'
import { scrubSinkText, scrubSinkValue, recordExceptionWithFingerprint } from '@arete/telemetry'
import {
  Prisma,
  resolvePlatformInstallationId as resolvePlatformInstallationIdFromDb,
} from '@arete/db'
import { prisma } from '../db.js'
import { logger } from '../logger.js'
import { routeIncidentToFix, defaultRouteIncidentDeps } from './incident.js'

const log = logger.child({ component: 'alerting' })
const tracer = trace.getTracer('arete-webhook')

let incidentsCounter: Counter | null = null
/** `arete.incidents` — closed dims only (Global Constraint 1): alertName,
 *  severity, status. Never installationId or any other tenant/identity data.
 *  Counts INCIDENT STATE CHANGES (open / resolve / re-fire), not deliveries:
 *  Alertmanager redelivers a still-firing alert every repeat interval, and
 *  counting those made `arete.incidents` a delivery counter wearing an
 *  incident counter's name (finding M8). */
function incidentsMetric(): Counter {
  if (!incidentsCounter) {
    const meter = metrics.getMeter('arete-webhook')
    incidentsCounter = meter.createCounter('arete.incidents', {
      description:
        'Incident state changes recorded from Alertmanager alerts (open/resolve/re-fire), by alert name, severity, and status',
    })
  }
  return incidentsCounter
}

/** The rule names that actually ship (infra/prometheus-rules/arete-alerts.yml).
 *  Metric dimensions must be a CLOSED set (Global Constraint 1, hard and
 *  review-blocking): `alertname` is free text on the wire, so anything not on
 *  this list is bucketed to `other` before it can become a Prometheus label
 *  and blow up cardinality (finding I3). Adding a rule means adding it here. */
const KNOWN_ALERT_NAMES: ReadonlySet<string> = new Set([
  'AreteReviewErrorRate',
  'AreteReviewLatencyP95',
  'AreteQueueFailureRate',
])

/** The only severities the system recognises. `severity` is a rule-authored
 *  label, but it arrives over the same untrusted wire as everything else, so
 *  it is normalised to this closed set before it is persisted OR used as a
 *  metric dimension. Unknown -> `warning`: the conservative direction, since
 *  `critical` is what opens a fix run (Task 4). */
const KNOWN_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'warning', 'info'])

/** Exported for the cardinality tests (finding I3). */
export function metricAlertName(alertName: string): string {
  return KNOWN_ALERT_NAMES.has(alertName) ? alertName : 'other'
}

/** Exported for the cardinality tests (finding I3). */
export function normaliseSeverity(severity: unknown): string {
  if (!isNonEmptyString(severity)) return 'warning'
  const normalised = severity.trim().toLowerCase()
  return KNOWN_SEVERITIES.has(normalised) ? normalised : 'warning'
}

/** Hard cap on any scalar column derived from the payload. Scrubbing removes
 *  secret shapes; it does not stop a 1 MB `alertname` from being persisted and
 *  rendered. */
const MAX_SCALAR_CHARS = 200
const MAX_FINGERPRINT_CHARS = 128
/** `summary` is rendered to a human (packages/dashboard/src/lib/incidents.ts),
 *  so it gets more room than a label — but it is still bounded. */
const MAX_SUMMARY_CHARS = 2000
/** Cap on retained resolve/re-fire cycles in `payload.priorCycles` (M7). */
const MAX_PRIOR_CYCLES = 10

function scrubScalar(value: string, max: number): string {
  return scrubSinkText(value).slice(0, max)
}

/** One alert instance inside an Alertmanager webhook payload
 *  (https://prometheus.io/docs/alerting/latest/configuration/#webhook_config). */
interface RawAlert {
  status?: unknown
  labels?: unknown
  annotations?: unknown
  startsAt?: unknown
  endsAt?: unknown
  fingerprint?: unknown
}

interface AlertmanagerPayload {
  alerts?: unknown
}

export interface HandleAlertResult {
  created: number
  updated: number
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Prior firing cycles already recorded on an incident's payload (M7). Tolerant
 *  of any shape: the column is Json and older rows predate this field. */
function readPriorCycles(payload: unknown): unknown[] {
  const cycles = asRecord(payload).priorCycles
  return Array.isArray(cycles) ? cycles.slice(-MAX_PRIOR_CYCLES) : []
}

function parseDate(v: unknown, fallback: Date): Date {
  if (!isNonEmptyString(v)) return fallback
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? fallback : d
}

/** Where `@arete/db`'s platform-installation diagnostics go. The shared module
 *  defaults to `console` (right for the Next.js dashboard); a bare console line
 *  here would bypass pino entirely, so the ambiguous-flag and migrate-off-the-
 *  env-var notices are adapted into this service's structured stream. */
const platformInstallationLog = {
  warn: (message: string) => log.warn({}, message),
  error: (message: string) => log.error({}, message),
}

/**
 * Resolve the ONE installation every incoming alert is attributed to
 * (finding C1). Returns null — meaning "drop the batch" — when the platform
 * installation is not resolvable.
 *
 * WHO DECIDES. Not this function: `@arete/db`'s `resolvePlatformInstallationId`
 * does, and the dashboard's telemetry gates ask the same one (contract §2, "one
 * resolver, one truth"). It answers from `Installation.isPlatform` — a database
 * fact, a deliberate and auditable single act — and falls back to
 * `ARETE_PLATFORM_INSTALLATION_ID` ONLY while no row carries the flag, logging
 * a migrate-to-the-flag notice when it does. That fallback is why upgrading a
 * deployment that has not flagged a row yet does not start silently dropping
 * every alert.
 *
 * FAIL CLOSED, three ways, all landing on "drop the batch":
 *   * no flagged row and no env fallback — nobody is the platform;
 *   * MORE than one flagged row — a misconfiguration the shared resolver
 *     refuses to settle by picking one, and says so loudly;
 *   * a database error while resolving — degraded must mean "record nothing".
 * Losing a platform alert is recoverable (Alertmanager re-sends a still-firing
 * alert every repeat interval — infra/alertmanager.yml); filing it against an
 * arbitrary customer, where Task 4 routing then opens a fix run in their
 * account, is not.
 *
 * The resolved id is still verified against a real `Installation` row here
 * (finding I6). The shared resolver deliberately does not do that — its other
 * caller only ever COMPARES the id against ids the reader is already authorized
 * for, so an unresolvable value simply matches nobody. This caller WRITES rows
 * under it, so a stale flag or a mistyped env var must drop the batch with an
 * explicit error rather than surface as a generic foreign-key failure inside the
 * per-alert catch. The lookup also yields the owner for the attribution warning
 * below, so an operator can see whose account alerts are being filed against —
 * it is memoised, so that line is logged once per resolved id, not per batch.
 */
let verifiedPlatformInstallationId: string | null = null
async function resolvePlatformInstallationId(): Promise<string | null> {
  // Asked per batch rather than memoised with the verification below: the flag
  // is a live database fact, so flagging (or un-flagging) a row must take
  // effect without a restart. It is one indexed read of at most two rows.
  const resolved = await resolvePlatformInstallationIdFromDb(prisma, {
    log: platformInstallationLog,
  })
  if (!isNonEmptyString(resolved)) {
    log.error(
      {},
      'no platform installation could be resolved — dropping every incoming alert. ' +
        'Alerting is inert until exactly one Installation row has isPlatform=true ' +
        '(or, transitionally, ARETE_PLATFORM_INSTALLATION_ID names one — see .env.example).'
    )
    return null
  }
  if (verifiedPlatformInstallationId === resolved) return resolved
  try {
    const installation = await prisma.installation.findUnique({
      where: { id: resolved },
      select: { id: true, owner: true },
    })
    if (!installation) {
      log.error(
        { configuredInstallationId: resolved },
        'the resolved platform installation id matches no Installation — dropping every incoming alert'
      )
      return null
    }
    verifiedPlatformInstallationId = installation.id
    log.warn(
      { installationId: installation.id, owner: installation.owner },
      'alert attribution: ALL incoming alerts are filed against this installation — ' +
        'it must be the platform-owned installation, never a customer tenant'
    )
    return installation.id
  } catch (err) {
    log.error({ err }, 'failed to verify the resolved platform installation — dropping alert batch')
    return null
  }
}

/**
 * Process one batch of Alertmanager alerts. Every alert is handled
 * independently: one malformed or failing alert in a batch is logged and
 * skipped, never aborting the rest of the batch and never throwing out of
 * this function (see header contract).
 */
export async function handleIncomingAlert(body: unknown): Promise<HandleAlertResult> {
  return tracer.startActiveSpan('incident.receive', async (span) => {
    let created = 0
    let updated = 0
    try {
      const payload = asRecord(body) as AlertmanagerPayload
      const alerts = Array.isArray(payload.alerts) ? (payload.alerts as unknown[]) : []
      span.setAttribute('arete.alerts.count', alerts.length)

      // Attribution is resolved ONCE per batch, from the platform-installation
      // fact (never from the payload), and recorded on the span so an operator
      // can see which tenant an incident landed in and WHY (finding M9).
      // Installation ids are span attributes, never metric dimensions (Global
      // Constraint 1).
      const installationId = await resolvePlatformInstallationId()
      span.setAttribute(
        'arete.alert.attribution_source',
        installationId ? 'platform-config' : 'unconfigured'
      )
      if (!installationId) {
        log.warn({ alertCount: alerts.length }, 'dropping alert batch — no platform installation')
        span.setStatus({ code: SpanStatusCode.OK })
        return { created, updated }
      }
      span.setAttribute('arete.installation.id', installationId)

      for (const raw of alerts) {
        const outcome = await processOneAlert(raw, installationId)
        if (outcome === 'created') created++
        else if (outcome === 'updated') updated++
      }
      span.setStatus({ code: SpanStatusCode.OK })
    } catch (err) {
      // Belt-and-suspenders: processOneAlert already catches its own errors,
      // but nothing about this batch loop may ever escape as an exception —
      // Alertmanager retries on non-2xx (see module header).
      log.error({ err }, 'unexpected error processing incoming alert batch')
      recordExceptionWithFingerprint(span, err instanceof Error ? err : new Error(String(err)))
      span.setStatus({ code: SpanStatusCode.ERROR })
    } finally {
      span.end()
    }
    return { created, updated }
  })
}

/**
 * @param installationId the configured platform installation resolved by the
 *   caller. It is a PARAMETER, not something derived from `raw`: nothing
 *   inside the payload may influence which tenant a row (and, via Task 4's
 *   routing, a WorkItem and a fix run) is created under.
 */
async function processOneAlert(
  raw: unknown,
  installationId: string
): Promise<'created' | 'updated' | 'skipped'> {
  try {
    const alert = asRecord(raw) as RawAlert
    const labels = asRecord(alert.labels)
    const annotations = asRecord(alert.annotations)

    // NOTE: `labels.installationId` is deliberately NOT read here. See the
    // module header (finding C1) — tenancy comes from the caller's configured
    // platform installation and from nowhere else.
    const rawAlertName = labels.alertname
    const rawFingerprint = alert.fingerprint
    const status = alert.status === 'resolved' ? 'resolved' : 'firing'

    // Malformed payload — log and drop THIS alert; never throw, never persist
    // a half-formed row (spec: "malformed payload must be logged and answered
    // 2xx" — the 2xx itself is the caller's job, this just must not throw).
    if (!isNonEmptyString(rawAlertName) || !isNonEmptyString(rawFingerprint)) {
      log.warn(
        {
          hasAlertName: isNonEmptyString(rawAlertName),
          hasFingerprint: isNonEmptyString(rawFingerprint),
        },
        'dropping malformed alert — missing required label/field'
      )
      return 'skipped'
    }

    // EVERY persisted field is scrubbed and bounded, not just payload/summary
    // (finding I2). `fingerprint` is the idempotency key, so it is scrubbed
    // rather than rejected: scrubbing is deterministic and idempotent, so the
    // same wire fingerprint always maps to the same stored key, and a real
    // Alertmanager fingerprint (hex) is unchanged by it. Task 4 derives the
    // WorkItem fingerprint from THIS value, so its
    // @@unique([installationId, fingerprint]) guard is unaffected.
    const alertName = scrubScalar(rawAlertName, MAX_SCALAR_CHARS)
    const fingerprint = scrubScalar(rawFingerprint, MAX_FINGERPRINT_CHARS)
    const severity = normaliseSeverity(labels.severity)

    const startsAt = parseDate(alert.startsAt, new Date())
    const resolvedAt = status === 'resolved' ? parseDate(alert.endsAt, new Date()) : null

    // Scrub BEFORE deriving anything persisted — annotations are
    // attacker-adjacent free text (Global Constraint 2). scrubSinkValue is the
    // canonical PERSISTENCE-sink scrubber: value patterns AND the REDACT_KEYS
    // key blocklist AND url-query stripping, recursing into nested objects.
    // scrubLogValue alone (what this used to call) applies value patterns
    // only — in the logging sink the key blocklist arrives separately via
    // pino's redact.paths, so this sink was getting half the canonical
    // redaction: `password: hunter2` and `?password=topsecret` both survived
    // (finding I5).
    const scrubbedLabels = scrubSinkValue(labels) as Record<string, unknown>
    const scrubbedAnnotations = scrubSinkValue(annotations) as Record<string, unknown>

    const existing = await prisma.incident.findUnique({
      where: { installationId_fingerprint: { installationId, fingerprint } },
      select: { id: true, status: true, startsAt: true, resolvedAt: true, payload: true },
    })

    // A resolved incident that fires again starts a NEW cycle: it used to flip
    // back to `firing`, null `resolvedAt`, and keep the FIRST cycle's
    // `startsAt`, silently losing the closed cycle entirely (finding M7). The
    // closed cycle is retained in `payload.priorCycles` (bounded) — the
    // schema has one row per (installationId, fingerprint), so per-cycle rows
    // would need a migration; this keeps the history without one.
    const refiring = existing != null && existing.status === 'resolved' && status === 'firing'
    const priorCycles = refiring
      ? [
          ...readPriorCycles(existing.payload),
          {
            startsAt: existing.startsAt?.toISOString() ?? null,
            resolvedAt: existing.resolvedAt?.toISOString() ?? null,
          },
        ].slice(-MAX_PRIOR_CYCLES)
      : readPriorCycles(existing?.payload)

    // Prisma's Json input type doesn't accept `Record<string, unknown>`
    // directly (unknown isn't a Json leaf type) — the cast is safe because
    // scrubSinkValue only ever produces JSON-serializable output (strings,
    // numbers, booleans, null, plain objects/arrays).
    const scrubbedPayload = {
      labels: scrubbedLabels,
      annotations: scrubbedAnnotations,
      ...(priorCycles.length > 0 ? { priorCycles } : {}),
    } as unknown as Prisma.InputJsonValue

    const rawSummary = isNonEmptyString(annotations.summary) ? annotations.summary : rawAlertName
    const summary = scrubScalar(rawSummary, MAX_SUMMARY_CHARS)

    const incident = await prisma.incident.upsert({
      where: { installationId_fingerprint: { installationId, fingerprint } },
      create: {
        installationId,
        fingerprint,
        alertName,
        severity,
        status,
        summary,
        payload: scrubbedPayload,
        startsAt,
        resolvedAt,
      },
      update: {
        alertName,
        severity,
        status,
        summary,
        payload: scrubbedPayload,
        resolvedAt,
        // Only on a re-fire: a plain repeat delivery must not move the clock.
        ...(refiring ? { startsAt } : {}),
      },
    })

    // Count state changes, not deliveries (finding M8). Alertmanager resends a
    // still-firing alert every repeat_interval (15m — infra/alertmanager.yml),
    // and incrementing on each of those made this a delivery counter.
    // Dimensions are the closed sets only (finding I3, Global Constraint 1).
    if (!existing || existing.status !== status) {
      incidentsMetric().add(1, { alertName: metricAlertName(alertName), severity, status })
    }

    // Incident -> WorkItem routing (Phase 2 Task 4). Runs AFTER the incident
    // write succeeds and is independently guarded so a routing failure can
    // never turn a correctly-recorded incident into a "failed" delivery that
    // Alertmanager retries (this function's own contract never throws, but
    // the try/catch here is belt-and-suspenders, matching the rest of this
    // module's "never propagate" posture).
    try {
      await routeIncidentToFix(incident.id, defaultRouteIncidentDeps())
    } catch (err) {
      log.error({ err, incidentId: incident.id }, 'incident-to-WorkItem routing failed')
    }

    return existing ? 'updated' : 'created'
  } catch (err) {
    log.error({ err }, 'failed to upsert incident for alert')
    return 'skipped'
  }
}
