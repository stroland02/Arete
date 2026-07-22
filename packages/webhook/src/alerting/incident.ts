// Incident -> WorkItem routing (Phase 2 Task 4). A critical Incident (Task 2/3)
// opens a WorkItem and dispatches it into the EXISTING fix path — the same
// pipeline the dashboard's "Fix it" button drives
// (packages/dashboard/src/app/api/work-items/[id]/fix/route.ts): create an
// IssueContainer at its real initial state (`detecting`), flip the WorkItem to
// `fixing` with that container id, then enqueue the fix-drive job
// (queue.ts's enqueueFixDrive). This is deliberately NOT a second trigger
// route — driveFix (fix/trigger.ts) halts at `ready` for the human
// approve -> send gate exactly as it does for a manually-triggered fix.
// Global Constraint 5 (HITL preserved): opening a fix run this way is
// explicitly allowed; nothing here can merge, apply, or post.
//
// Idempotency (the crux — see task brief critical context #3): Alertmanager
// redelivers a still-firing alert on its repeat interval, and the receiver's
// upsert calls this function again for the SAME incident every time. Two
// things guard against opening a second WorkItem:
//   1. Fast path: once `Incident.workItemId` is set, every subsequent call
//      returns `already_routed` before touching WorkItem at all.
//   2. Race-safe path: (1) alone has a TOCTOU gap — two concurrent deliveries
//      (a genuine repeat interval overlapping a slow request, or two
//      Alertmanager replicas) can both read workItemId as null before either
//      writes it back. The real guard for that case is NOT app-level
//      sequencing — it is WorkItem's own `@@unique([installationId,
//      fingerprint])` constraint (packages/db/prisma/schema.prisma), exactly
//      the mechanism scan/trigger.ts already relies on for the same reason.
//      This module derives a WorkItem fingerprint deterministically from the
//      incident's own (installationId, fingerprint), so two racing creates
//      collide at the DB and the loser catches the unique-constraint error,
//      re-reads the winner's row, and converges on the identical WorkItem id
//      — never opening a second row, never dispatching a second fix drive.
//
// Tenancy (Global Constraint 4): every read/write here is scoped by the
// incident's own installationId — Incident.workItemId is a plain String?
// column with NO Prisma relation (task brief critical context #1), so nothing
// here ever traverses a relation to reach a WorkItem; every lookup is by id
// or by the (installationId, fingerprint) compound key.
//
// This function must NEVER throw (same contract as receiver.ts): the caller
// runs it right after a successful Incident upsert, and a bug here must never
// retroactively turn a correctly-recorded incident into a failed delivery
// that Alertmanager retries.

import { trace, metrics, SpanStatusCode, type Counter } from '@opentelemetry/api'
import { recordExceptionWithFingerprint } from '@arete/telemetry'
import type { Prisma } from '@arete/db'
import { logger } from '../logger.js'

const log = logger.child({ component: 'alerting' })
const tracer = trace.getTracer('arete-webhook')

let routedCounter: Counter | null = null
/** `arete.incidents.routed` — closed dims only (Global Constraint 1): reason.
 *  Never installationId or any other tenant/identity data. */
function routedMetric(): Counter {
  if (!routedCounter) {
    const meter = metrics.getMeter('arete-webhook')
    routedCounter = meter.createCounter('arete.incidents.routed', {
      description: 'Incident-to-WorkItem routing outcomes, by reason',
    })
  }
  return routedCounter
}

/** WorkItem.kind for every alert-born work item (task brief: `kind: "error"`). */
const ALERT_WORK_ITEM_KIND = 'error'
/** One of the six review dimensions the existing model requires
 *  (packages/db/prisma/schema.prisma WorkItem.dimension comment). Alert-born
 *  incidents are production/operational health signals, which this codebase's
 *  dimension taxonomy maps to "deployment_safety". */
const ALERT_WORK_ITEM_DIMENSION = 'deployment_safety'
/** 0-1 scale (this codebase never uses 0-10 — see Task 7's rubric table). An
 *  alert firing is an OBSERVED production condition, not an inferred one, so
 *  it sits at the top of the rubric's confidence band ("0.9-1.0: ... an
 *  observed/reproduced failure"). */
const ALERT_WORK_ITEM_CONFIDENCE = 0.9

export interface RouteIncidentResult {
  routed: boolean
  reason?: 'not_found' | 'not_critical' | 'not_firing' | 'already_routed' | 'error'
  workItemId?: string
}

interface IncidentRow {
  id: string
  installationId: string
  fingerprint: string
  alertName: string
  severity: string
  status: string
  summary: string
  workItemId: string | null
}

interface WorkItemRow {
  id: string
}

export interface RouteIncidentDeps {
  prisma: {
    incident: {
      findUnique(args: unknown): Promise<IncidentRow | null>
      update(args: unknown): Promise<unknown>
    }
    workItem: {
      create(args: unknown): Promise<WorkItemRow>
      findUnique(args: unknown): Promise<WorkItemRow | null>
      update(args: unknown): Promise<unknown>
    }
    repository: {
      findFirst(args: unknown): Promise<{ fullName: string } | null>
    }
    issueContainer: {
      create(args: unknown): Promise<{ id: string }>
    }
  }
  enqueueFixDrive(data: { workItemId: string }): Promise<unknown>
  checkCooldown(workItemId: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }>
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

/** WorkItem fingerprint derived deterministically from the incident's own
 *  (installationId, fingerprint) — namespaced so it can never collide with a
 *  scan-derived fingerprint that happens to hash to the same string. */
function workItemFingerprintFor(incident: Pick<IncidentRow, 'fingerprint'>): string {
  return `incident:${incident.fingerprint}`
}

/**
 * Routes ONE incident to its WorkItem/fix-drive, or records why it did not.
 * Called by the receiver right after every successful Incident upsert.
 */
export async function routeIncidentToFix(incidentId: string, deps: RouteIncidentDeps): Promise<RouteIncidentResult> {
  return tracer.startActiveSpan('incident.route', async (span): Promise<RouteIncidentResult> => {
    try {
      const incident = await deps.prisma.incident.findUnique({ where: { id: incidentId } })
      if (!incident) {
        span.setAttribute('arete.incident.route.reason', 'not_found')
        return { routed: false, reason: 'not_found' }
      }

      span.setAttribute('arete.incident.severity', incident.severity)

      if (incident.severity !== 'critical') {
        routedMetric().add(1, { reason: 'not_critical' })
        return { routed: false, reason: 'not_critical' }
      }

      // Only an active alert opens a fix run — one that already resolved by
      // the time this delivery lands has nothing left to heal.
      if (incident.status !== 'firing') {
        routedMetric().add(1, { reason: 'not_firing' })
        return { routed: false, reason: 'not_firing' }
      }

      // Fast path: the common case for a repeat delivery. No WorkItem access
      // at all once this is set.
      if (incident.workItemId) {
        routedMetric().add(1, { reason: 'already_routed' })
        return { routed: false, reason: 'already_routed', workItemId: incident.workItemId }
      }

      const fingerprint = workItemFingerprintFor(incident)
      let workItem: WorkItemRow
      let created = false
      try {
        workItem = await deps.prisma.workItem.create({
          data: {
            installationId: incident.installationId,
            kind: ALERT_WORK_ITEM_KIND,
            source: 'telemetry',
            title: incident.alertName,
            detail: incident.summary,
            evidence: [] as unknown as Prisma.InputJsonValue,
            dimension: ALERT_WORK_ITEM_DIMENSION,
            confidence: ALERT_WORK_ITEM_CONFIDENCE,
            state: 'open',
            fingerprint,
          },
        })
        created = true
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err
        // Lost the race: another concurrent delivery already created this
        // WorkItem. Re-read its row (the DB unique constraint guarantees it
        // exists) and converge on the SAME id rather than opening a second.
        const existing = await deps.prisma.workItem.findUnique({
          where: { installationId_fingerprint: { installationId: incident.installationId, fingerprint } },
        })
        if (!existing) throw err
        workItem = existing
      }

      // Link back — idempotent regardless of which racer sets it, since both
      // converge on the identical workItem.id.
      await deps.prisma.incident.update({ where: { id: incident.id }, data: { workItemId: workItem.id } })

      if (!created) {
        // The winner already dispatched the container + fix drive; do not
        // double-dispatch.
        routedMetric().add(1, { reason: 'already_routed' })
        return { routed: false, reason: 'already_routed', workItemId: workItem.id }
      }

      await dispatchFixDrive(incident, workItem.id, deps)

      routedMetric().add(1, { reason: 'routed' })
      span.setStatus({ code: SpanStatusCode.OK })
      return { routed: true, workItemId: workItem.id }
    } catch (err) {
      log.error({ err, incidentId }, 'failed to route incident to a WorkItem')
      recordExceptionWithFingerprint(span, err instanceof Error ? err : new Error(String(err)))
      span.setStatus({ code: SpanStatusCode.ERROR })
      return { routed: false, reason: 'error' }
    } finally {
      span.end()
    }
  })
}

/**
 * Enters the EXISTING fix path for a freshly-opened WorkItem — mirrors
 * packages/dashboard/src/app/api/work-items/[id]/fix/route.ts exactly (create
 * the IssueContainer at `detecting`, flip the WorkItem to `fixing`, enqueue).
 * Best-effort: a tenant with no connected repository, or an active cooldown,
 * simply leaves the WorkItem open in the inbox rather than failing the whole
 * routing call — the incident is still correctly recorded and linked either
 * way (task brief only requires the WorkItem to open and link; a repo/model
 * connection is a precondition the manual "Fix it" path already handles the
 * same way).
 */
async function dispatchFixDrive(incident: IncidentRow, workItemId: string, deps: RouteIncidentDeps): Promise<void> {
  const repo = await deps.prisma.repository.findFirst({
    where: { installationId: incident.installationId },
    orderBy: { createdAt: 'asc' },
    select: { fullName: true },
  })
  if (!repo) {
    log.info({ workItemId, installationId: incident.installationId }, 'no connected repository — WorkItem opened but no fix drive dispatched')
    return
  }

  const [owner, ...rest] = repo.fullName.split('/')
  const container = await deps.prisma.issueContainer.create({
    data: {
      installationId: incident.installationId,
      state: 'detecting',
      gates: { solutionApprovedAt: null },
      target: { owner: owner ?? '', repo: rest.join('/') },
      pr: {
        base: 'main',
        branch: `kuma/${ALERT_WORK_ITEM_KIND}-${workItemId.slice(0, 8)}`,
        title: incident.alertName,
        body: incident.summary,
      },
      patch: [],
      findings: [],
    },
  })

  await deps.prisma.workItem.update({
    where: { id: workItemId },
    data: { state: 'fixing', containerId: container.id },
  })

  // Cooldown (Task 6): a brand-new WorkItem has fixFailureCount 0 and always
  // passes, but this call site respects the guard rather than bypassing it —
  // the same contract the queue consumer and the dashboard route both honor.
  const cooldown = await deps.checkCooldown(workItemId)
  if (!cooldown.allowed) {
    log.info({ workItemId, retryAfterSeconds: cooldown.retryAfterSeconds }, 'fix cooldown active — WorkItem opened but drive not enqueued')
    return
  }

  await deps.enqueueFixDrive({ workItemId })
}

/** Real deps: lazy @arete/db import (route/receiver registration stays
 *  DB-import-free until called, matching fix/trigger.ts's and
 *  fix/cooldown.ts's defaultXDeps pattern), the real queue enqueue, and the
 *  real cooldown check. */
export function defaultRouteIncidentDeps(): RouteIncidentDeps {
  return {
    prisma: {
      incident: {
        findUnique: async (args: unknown) => {
          const { prisma } = await import('../db.js')
          return prisma.incident.findUnique(args as any) as any
        },
        update: async (args: unknown) => {
          const { prisma } = await import('../db.js')
          return prisma.incident.update(args as any)
        },
      },
      workItem: {
        create: async (args: unknown) => {
          const { prisma } = await import('../db.js')
          return prisma.workItem.create(args as any) as any
        },
        findUnique: async (args: unknown) => {
          const { prisma } = await import('../db.js')
          return prisma.workItem.findUnique(args as any) as any
        },
        update: async (args: unknown) => {
          const { prisma } = await import('../db.js')
          return prisma.workItem.update(args as any)
        },
      },
      repository: {
        findFirst: async (args: unknown) => {
          const { prisma } = await import('../db.js')
          return prisma.repository.findFirst(args as any) as any
        },
      },
      issueContainer: {
        create: async (args: unknown) => {
          const { prisma } = await import('../db.js')
          return prisma.issueContainer.create(args as any) as any
        },
      },
    },
    enqueueFixDrive: async (data) => {
      const { enqueueFixDrive } = await import('../queue.js')
      return enqueueFixDrive(data)
    },
    checkCooldown: async (workItemId) => {
      const { checkFixCooldown, defaultCooldownDeps } = await import('../fix/cooldown.js')
      return checkFixCooldown(workItemId, defaultCooldownDeps())
    },
  }
}
