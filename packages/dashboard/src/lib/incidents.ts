// The Incident inbox query: alerts Kuma's own monitoring fired (Prometheus →
// Alertmanager → the token-guarded receiver), tenant-scoped exactly like
// every other read in lib/. Incident.workItemId is a PLAIN COLUMN with no
// Prisma relation (matches the existing WorkItem.containerId convention), so
// the fix-run link is resolved with a second, separately-scoped lookup rather
// than an `include`.

import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@arete/db';

export interface IncidentView {
  id: string;
  fingerprint: string;
  alertName: string;
  /** "critical" | "warning" */
  severity: string;
  /** "firing" | "resolved" */
  status: string;
  summary: string;
  startsAt: string; // ISO — client-safe
  resolvedAt: string | null;
  /** Set when a user triaged this incident as noise (non-actionable). Null =
   *  not noise. Orthogonal to status (the receiver never touches it). */
  noisedAt: string | null;
  /** "alert" (Alertmanager receiver) | "manual" (a New investigation). */
  source: string;
  /** The WorkItem this incident opened, if any. Null if it never opened one. */
  workItemId: string | null;
  /** The linked WorkItem's containerId, when its fix run has actually started.
   *  Null when there is no linked WorkItem, or it hasn't opened a container yet. */
  fixContainerId: string | null;
}

/** Prisma delegates this module actually uses — structural, so tests inject a
 *  fake and the page passes the real client. */
type IncidentsDb = {
  incident: { findMany(args: unknown): Promise<unknown[]> };
  workItem: { findMany(args: unknown): Promise<unknown[]> };
};

export interface IncidentDetail {
  id: string;
  fingerprint: string;
  alertName: string;
  /** "critical" | "warning" */
  severity: string;
  /** "firing" | "resolved" */
  status: string;
  summary: string;
  startsAt: string; // ISO — client-safe
  resolvedAt: string | null;
  /** Set when a user triaged this incident as noise. Null = not noise. */
  noisedAt: string | null;
  /** "alert" (Alertmanager receiver) | "manual" (a New investigation). */
  source: string;
  /** Alert labels + annotations as received and scrubbed (receiver.ts) —
   *  `{ labels: Record<string, unknown>; annotations: Record<string, unknown>; ... }`.
   *  Passed through as-is; already scrubbed before it was written. */
  payload: unknown;
  workItemId: string | null;
  fixContainerId: string | null;
}

/** Prisma delegates `getIncidentDetail` uses — a single-row lookup by id, so
 *  `findFirst` rather than the list's `findMany`. */
type IncidentDetailDb = {
  incident: { findFirst(args: unknown): Promise<unknown | null> };
  workItem: { findFirst(args: unknown): Promise<unknown | null> };
};

const LIMIT = 100;

/**
 * Loads the caller's incidents (newest first), scoped by
 * `installationId: { in: installationIds }` like every other query in lib/ —
 * an incident belonging to an installation outside this list can never
 * appear. Empty `installationIds` => `[]`, no query run.
 *
 * For each incident with a `workItemId`, resolves that WorkItem's
 * `containerId` (also scoped to `installationIds`, defense in depth even
 * though a workItemId should only ever reference a WorkItem in the same
 * installation) so the UI can deep-link to the live fix-run stream at
 * `/services?container=<containerId>` — the same route WorkItemPanel already
 * uses for that purpose.
 */
export async function getIncidents(
  db: IncidentsDb | PrismaClient,
  installationIds: string[],
): Promise<IncidentView[]> {
  if (installationIds.length === 0) return [];

  const rows = (await (db as IncidentsDb).incident.findMany({
    where: { installationId: { in: installationIds } },
    orderBy: { startsAt: 'desc' },
    take: LIMIT,
  })) as Array<Record<string, unknown>>;

  const workItemIds = [
    ...new Set(
      rows
        .map((r) => r.workItemId)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];

  const containerByWorkItem = new Map<string, string>();
  if (workItemIds.length > 0) {
    const workItems = (await (db as IncidentsDb).workItem.findMany({
      where: { id: { in: workItemIds }, installationId: { in: installationIds } },
      select: { id: true, containerId: true },
    })) as Array<{ id: string; containerId: string | null }>;
    for (const wi of workItems) {
      if (wi.containerId) containerByWorkItem.set(wi.id, wi.containerId);
    }
  }

  return rows.map((r) => {
    const workItemId = (r.workItemId ?? null) as string | null;
    return {
      id: String(r.id),
      fingerprint: String(r.fingerprint),
      alertName: String(r.alertName),
      severity: String(r.severity),
      status: String(r.status),
      summary: String(r.summary),
      startsAt: (r.startsAt as Date).toISOString(),
      resolvedAt: r.resolvedAt ? (r.resolvedAt as Date).toISOString() : null,
      noisedAt: r.noisedAt ? (r.noisedAt as Date).toISOString() : null,
      source: String(r.source ?? 'alert'),
      workItemId,
      fixContainerId: workItemId ? containerByWorkItem.get(workItemId) ?? null : null,
    };
  });
}

/**
 * Loads ONE incident by id, scoped exactly like `getIncidents` —
 * `where: { id, installationId: { in: installationIds } }`. A row whose
 * installation is not in `installationIds` never matches that WHERE clause,
 * so it comes back `null` from the SAME query path as a genuinely missing
 * id — a cross-tenant probe cannot distinguish "not yours" from "doesn't
 * exist" (Global Constraint 4). Empty `installationIds` => `null`, no query
 * run, same short-circuit as `getIncidents`' `[]`.
 *
 * Resolves the linked WorkItem's `containerId` (also scoped to
 * `installationIds`) for the "View fix run" deep link, the same
 * defense-in-depth lookup `getIncidents` performs per row.
 */
export async function getIncidentDetail(
  db: IncidentDetailDb | PrismaClient,
  installationIds: string[],
  id: string,
): Promise<IncidentDetail | null> {
  if (installationIds.length === 0) return null;

  const row = (await (db as IncidentDetailDb).incident.findFirst({
    where: { id, installationId: { in: installationIds } },
  })) as Record<string, unknown> | null;

  if (!row) return null;

  const workItemId = (row.workItemId ?? null) as string | null;

  let fixContainerId: string | null = null;
  if (workItemId) {
    const workItem = (await (db as IncidentDetailDb).workItem.findFirst({
      where: { id: workItemId, installationId: { in: installationIds } },
      select: { containerId: true },
    })) as { containerId: string | null } | null;
    fixContainerId = workItem?.containerId ?? null;
  }

  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    alertName: String(row.alertName),
    severity: String(row.severity),
    status: String(row.status),
    summary: String(row.summary),
    startsAt: (row.startsAt as Date).toISOString(),
    resolvedAt: row.resolvedAt ? (row.resolvedAt as Date).toISOString() : null,
    noisedAt: row.noisedAt ? (row.noisedAt as Date).toISOString() : null,
    source: String(row.source ?? 'alert'),
    payload: row.payload,
    workItemId,
    fixContainerId,
  };
}

/** Prisma delegates the incident mutations use. Structural so tests inject a
 *  fake and the server actions pass the real client. */
type IncidentMutationsDb = {
  incident: {
    create(args: unknown): Promise<{ id: string }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

/**
 * Opens a MANUAL incident (a "New investigation") for one installation. The
 * caller is responsible for having already verified `installationId` belongs
 * to the signed-in session (see the server action) — this function trusts the
 * id it is given, exactly like the connection actions' write path.
 *
 * A manual incident carries `source: "manual"` and a `manual-<uuid>`
 * fingerprint (the Alertmanager path uses Alertmanager's own fingerprint; a
 * hand-opened one has none, so we synthesize a collision-free one to satisfy
 * the `@@unique([installationId, fingerprint])` constraint). It starts
 * `firing` and un-triaged, so it lands in the Open tab immediately.
 */
export async function createManualIncident(
  db: IncidentMutationsDb | PrismaClient,
  installationId: string,
  input: { alertName: string; severity: string; summary: string },
): Promise<string> {
  const created = (await (db as IncidentMutationsDb).incident.create({
    data: {
      installationId,
      fingerprint: `manual-${randomUUID()}`,
      alertName: input.alertName,
      severity: input.severity,
      status: 'firing',
      summary: input.summary,
      source: 'manual',
      payload: { source: 'manual' },
      startsAt: new Date(),
    },
  })) as { id: string };
  return created.id;
}

/**
 * Marks an incident as noise (non-actionable) or clears that. Tenant-scoped
 * like every write in lib/: the `updateMany` WHERE pins `installationId: { in:
 * installationIds }`, so an id belonging to an installation outside the
 * caller's list matches zero rows and is a silent no-op — a cross-tenant probe
 * cannot mutate, and cannot distinguish "not yours" from "doesn't exist".
 * Empty `installationIds` => no query, returns false. Returns whether a row
 * was actually updated.
 */
export async function setIncidentNoise(
  db: IncidentMutationsDb | PrismaClient,
  installationIds: string[],
  id: string,
  noise: boolean,
): Promise<boolean> {
  if (installationIds.length === 0) return false;
  const result = (await (db as IncidentMutationsDb).incident.updateMany({
    where: { id, installationId: { in: installationIds } },
    data: { noisedAt: noise ? new Date() : null },
  })) as { count: number };
  return result.count > 0;
}
