// The Incident inbox query: alerts Kuma's own monitoring fired (Prometheus →
// Alertmanager → the token-guarded receiver), tenant-scoped exactly like
// every other read in lib/. Incident.workItemId is a PLAIN COLUMN with no
// Prisma relation (matches the existing WorkItem.containerId convention), so
// the fix-run link is resolved with a second, separately-scoped lookup rather
// than an `include`.

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
      workItemId,
      fixContainerId: workItemId ? containerByWorkItem.get(workItemId) ?? null : null,
    };
  });
}
