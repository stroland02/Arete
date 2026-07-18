// The work-item inbox query: everything the Services rail needs to render a
// tenant's discovered work — open/fixing/staged/posted items (dismissed is a
// decision and stays hidden by default) plus the newest ScanRun for the honest
// scan-status line. Tenant-scoped by installationId on EVERY query, like all
// of lib/queries.ts.

import type { PrismaClient } from '@arete/db';

export interface WorkItemView {
  id: string;
  kind: 'issue' | 'opportunity' | 'error' | 'pr_finding';
  title: string;
  detail: string;
  evidence: { path: string; line: number; excerpt?: string }[];
  dimension: string;
  confidence: number;
  state: 'open' | 'fixing' | 'staged' | 'posted' | 'dismissed';
  /** Set once Fix started — deep-links the live container stream / PR panel. */
  containerId?: string | null;
}

export interface InboxView {
  items: WorkItemView[];
  lastScan: {
    status: string;
    finishedAt: string | null;
    /** Failure reason for status "failed" — shown verbatim ("Scan failed: <err>"). */
    error?: string | null;
  } | null;
}

/** Prisma delegates this module actually uses — structural, so tests inject a
 *  fake and the page passes the real client. */
type InboxDb = {
  workItem: { findMany(args: unknown): Promise<unknown[]> };
  scanRun: {
    findFirst(args: unknown): Promise<{
      status: string;
      error: string | null;
      finishedAt: Date | null;
    } | null>;
  };
};

export async function getWorkItemInbox(
  db: InboxDb | PrismaClient,
  installationIds: string[],
): Promise<InboxView> {
  if (installationIds.length === 0) {
    return { items: [], lastScan: null };
  }

  const scope = { installationId: { in: installationIds } } as const;
  const [rows, lastRun] = await Promise.all([
    (db as InboxDb).workItem.findMany({
      where: { ...scope, state: { not: 'dismissed' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    (db as InboxDb).scanRun.findFirst({
      where: scope,
      orderBy: { startedAt: 'desc' },
    }),
  ]);

  const items = (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    kind: r.kind as WorkItemView['kind'],
    title: String(r.title),
    detail: String(r.detail),
    evidence: (Array.isArray(r.evidence) ? r.evidence : []) as WorkItemView['evidence'],
    dimension: String(r.dimension),
    confidence: Number(r.confidence),
    state: r.state as WorkItemView['state'],
    containerId: (r.containerId ?? null) as string | null,
  }));

  return {
    items,
    lastScan: lastRun
      ? {
          status: lastRun.status,
          finishedAt: lastRun.finishedAt ? lastRun.finishedAt.toISOString() : null,
          error: lastRun.error ?? null,
        }
      : null,
  };
}
