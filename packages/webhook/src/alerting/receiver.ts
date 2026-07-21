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
// never a bespoke one.

import { trace, metrics, SpanStatusCode, type Counter } from '@opentelemetry/api'
import { scrubText, scrubLogValue } from '@arete/telemetry'
import { Prisma } from '@arete/db'
import { prisma } from '../db.js'
import { logger } from '../logger.js'
import { routeIncidentToFix, defaultRouteIncidentDeps } from './incident.js'

const log = logger.child({ component: 'alerting' })
const tracer = trace.getTracer('arete-webhook')

let incidentsCounter: Counter | null = null
/** `arete.incidents` — closed dims only (Global Constraint 1): alertName,
 *  severity, status. Never installationId or any other tenant/identity data. */
function incidentsMetric(): Counter {
  if (!incidentsCounter) {
    const meter = metrics.getMeter('arete-webhook')
    incidentsCounter = meter.createCounter('arete.incidents', {
      description: 'Incidents recorded from Alertmanager alerts, by alert name, severity, and status',
    })
  }
  return incidentsCounter
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

function parseDate(v: unknown, fallback: Date): Date {
  if (!isNonEmptyString(v)) return fallback
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? fallback : d
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

      for (const raw of alerts) {
        const outcome = await processOneAlert(raw)
        if (outcome === 'created') created++
        else if (outcome === 'updated') updated++
      }
      span.setStatus({ code: SpanStatusCode.OK })
    } catch (err) {
      // Belt-and-suspenders: processOneAlert already catches its own errors,
      // but nothing about this batch loop may ever escape as an exception —
      // Alertmanager retries on non-2xx (see module header).
      log.error({ err }, 'unexpected error processing incoming alert batch')
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.setStatus({ code: SpanStatusCode.ERROR })
    } finally {
      span.end()
    }
    return { created, updated }
  })
}

async function processOneAlert(raw: unknown): Promise<'created' | 'updated' | 'skipped'> {
  try {
    const alert = asRecord(raw) as RawAlert
    const labels = asRecord(alert.labels)
    const annotations = asRecord(alert.annotations)

    // Tenancy attribution for PLATFORM-WIDE alerts (user ruling 2026-07-21,
    // "configured platform owner, receiver-side"). The three shipped rules
    // (AreteReviewErrorRate, AreteReviewLatencyP95, AreteQueueFailureRate)
    // deliberately carry NO installationId label: metric dimensions must be
    // closed low-cardinality sets, so a tenant id can never be one (spec §5,
    // Global Constraint 1). Without a fallback every real alert would be
    // logged-and-dropped here and the whole alerting chain would only ever
    // work for synthetic alerts that hand-set the label.
    //
    // Fallback, never override: an alert that DOES carry installationId keeps
    // it, so a future per-tenant rule attributes to that tenant. Only
    // unlabelled (i.e. platform-wide) alerts land on the operator-owned
    // installation. If the env var is unset the old drop behaviour stands —
    // dropping a platform alert is recoverable, filing it against an arbitrary
    // customer is not.
    const platformInstallationId = process.env.ARETE_PLATFORM_INSTALLATION_ID
    const installationId = isNonEmptyString(labels.installationId)
      ? labels.installationId
      : isNonEmptyString(platformInstallationId)
        ? platformInstallationId
        : undefined
    const alertName = labels.alertname
    const fingerprint = alert.fingerprint
    const status = alert.status === 'resolved' ? 'resolved' : 'firing'
    const severity = isNonEmptyString(labels.severity) ? labels.severity : 'warning'

    // Malformed payload — log and drop THIS alert; never throw, never persist
    // a half-formed row (spec: "malformed payload must be logged and answered
    // 2xx" — the 2xx itself is the caller's job, this just must not throw).
    if (!isNonEmptyString(installationId) || !isNonEmptyString(alertName) || !isNonEmptyString(fingerprint)) {
      log.warn(
        {
          hasInstallationId: isNonEmptyString(installationId),
          hasAlertName: isNonEmptyString(alertName),
          hasFingerprint: isNonEmptyString(fingerprint),
        },
        'dropping malformed alert — missing required label/field'
      )
      return 'skipped'
    }

    const startsAt = parseDate(alert.startsAt, new Date())
    const resolvedAt = status === 'resolved' ? parseDate(alert.endsAt, new Date()) : null

    // Scrub BEFORE deriving anything persisted — annotations are
    // attacker-adjacent free text (Global Constraint 2). scrubLogValue
    // recurses into nested objects, so a secret buried in e.g.
    // annotations.nested.deep.value is caught, not just top-level strings.
    const scrubbedLabels = scrubLogValue(labels) as Record<string, unknown>
    const scrubbedAnnotations = scrubLogValue(annotations) as Record<string, unknown>
    // Prisma's Json input type doesn't accept `Record<string, unknown>`
    // directly (unknown isn't a Json leaf type) — the cast is safe because
    // scrubLogValue only ever produces JSON-serializable output (strings,
    // numbers, booleans, null, plain objects/arrays).
    const scrubbedPayload = {
      labels: scrubbedLabels,
      annotations: scrubbedAnnotations,
    } as unknown as Prisma.InputJsonValue

    const rawSummary = isNonEmptyString(annotations.summary) ? annotations.summary : alertName
    const summary = scrubText(rawSummary)

    const existing = await prisma.incident.findUnique({
      where: { installationId_fingerprint: { installationId, fingerprint } },
      select: { id: true },
    })

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
      },
    })

    incidentsMetric().add(1, { alertName, severity, status })

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
