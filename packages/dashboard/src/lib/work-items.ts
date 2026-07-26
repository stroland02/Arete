// The work-item inbox query: everything the Services rail needs to render a
// tenant's discovered work — open/fixing/staged/posted items (dismissed is a
// decision and stays hidden by default) plus the newest ScanRun for the honest
// scan-status line. Tenant-scoped by installationId on EVERY query, like all
// of lib/queries.ts.

import type { PrismaClient } from '@arete/db';
import { computeFixCooldown, type FixCooldownResult } from './fix-cooldown';

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
  /**
   * The linked container's REAL persisted lifecycle state, when it could be
   * read. This is what decides which human gate the panel may offer: the
   * approve route enforces `ready` against stored state server-side, so
   * offering Approve on a container still at `detecting` would be a control
   * that cannot act. `null` means "not known" (no container, or the read
   * failed) — distinct from any actual state, and it offers no gate at all.
   */
  containerState?: string | null;
  /** The posted PR's URL, when the container's pr JSON carries one. */
  prUrl?: string | null;
  /**
   * Fix-run cooldown state (Phase 3 Task 8), computed from the item's
   * fixFailureCount/fixFailureAt via the SAME pure computeFixCooldown the fix
   * API route enforces server-side (fix-cooldown.ts) — never re-derived here.
   * Lets the Services UI show "retry available in Xm" and disable Fix it
   * BEFORE the user clicks, instead of only after a 429.
   */
  fixCooldown: FixCooldownResult;
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

  // Linked-container facts: the PR url for posted items, and the container's
  // real lifecycle state (which human gate, if any, the panel may offer).
  // Tenant-scoped. Optional — a store without the delegate (older fakes)
  // simply yields neither, never an error; an unknown state offers no gate.
  const prUrls = new Map<string, string>();
  const containerStates = new Map<string, string>();
  const containerIds = (rows as Array<{ containerId?: string | null }>)
    .map((r) => r.containerId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  const issueContainer = (db as { issueContainer?: { findMany(args: unknown): Promise<unknown[]> } }).issueContainer;
  if (containerIds.length > 0 && issueContainer?.findMany) {
    try {
      const containers = (await issueContainer.findMany({
        where: { id: { in: containerIds }, ...scope },
        select: { id: true, pr: true, state: true },
      })) as Array<{ id: string; pr: unknown; state?: unknown }>;
      for (const c of containers) {
        const url = (c.pr as { url?: unknown } | null)?.url;
        if (typeof url === 'string') prUrls.set(c.id, url);
        if (typeof c.state === 'string' && c.state.length > 0) containerStates.set(c.id, c.state);
      }
    } catch {
      // These are an enhancement — the inbox itself must never fail on them.
      // Failing here leaves every containerState null, so the panel falls back
      // to offering no gate rather than guessing one.
    }
  }

  const items = (rows as Array<Record<string, unknown>>).map((r) => {
    const fixFailureCount = typeof r.fixFailureCount === 'number' ? r.fixFailureCount : 0;
    const fixFailureAt = r.fixFailureAt ? new Date(r.fixFailureAt as string | Date) : null;
    return {
      id: String(r.id),
      kind: r.kind as WorkItemView['kind'],
      title: String(r.title),
      detail: String(r.detail),
      evidence: (Array.isArray(r.evidence) ? r.evidence : []) as WorkItemView['evidence'],
      dimension: String(r.dimension),
      confidence: Number(r.confidence),
      state: r.state as WorkItemView['state'],
      containerId: (r.containerId ?? null) as string | null,
      containerState:
        typeof r.containerId === 'string' ? containerStates.get(r.containerId) ?? null : null,
      prUrl: typeof r.containerId === 'string' ? prUrls.get(r.containerId) ?? null : null,
      fixCooldown: computeFixCooldown(fixFailureCount, fixFailureAt),
    };
  });

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
