/**
 * Infrastructure-approval prompts — the read side of a safety gate that was
 * fully built on the backend and invisible in the product.
 *
 * How one comes to exist: a review agent calls the `request_infrastructure_approval`
 * tool (packages/agents/.../tools/actions.py), the run PAUSES, and a PENDING
 * ApprovalPrompt is written carrying the EXACT command and the reason for it.
 * Nothing continues until a human decides. The execute side already exists
 * (webhook POST /api/approvals/:id/execute -> `approval-exec` queue -> agents
 * POST /approvals/apply, idempotent per approval id) — what was missing is any
 * surface that shows a human the pending decision, so a paused agent waited on
 * a click that had nowhere to happen.
 *
 * Tenancy: an ApprovalPrompt has no installationId of its own; it hangs off a
 * Review, which hangs off a Repository, which carries one. Every read here is
 * therefore scoped through `review.repository.installationId IN installationIds`
 * — the same choke point lib/queries.ts uses — so a prompt from another
 * tenant's review can never be listed or actioned. Empty ids => `[]`.
 *
 * `[]` here genuinely means "no pending approvals", not "unavailable": listing
 * requires only ordinary tenancy, never a platform gate, so there is no
 * unavailable state to confuse it with.
 */

import type { PrismaClient } from '@arete/db';

export interface PendingApprovalView {
  id: string;
  /** The exact command the agent proposes to run. Rendered verbatim, never
   *  summarised — a human approving a command must see the command. */
  command: string;
  /** The agent's stated reason for needing it. */
  reason: string;
  createdAt: string; // ISO — client-safe
  /** Where it came from, so the decision has context. */
  repositoryFullName: string;
  prNumber: number;
}

/** The slice of Prisma this module uses — structural, so tests inject a fake
 *  and the page passes the real client (the lib/queries.ts convention). */
type ApprovalsDb = {
  approvalPrompt: { findMany(args: unknown): Promise<unknown[]> };
};

/**
 * Every PENDING approval awaiting a human across the caller's installations,
 * oldest first — the one that has been blocking an agent longest is the one to
 * decide next.
 *
 * Deliberately PENDING-only. An APPROVED/EXECUTED row is a decision already
 * made and a REJECTED one is closed; showing them as if they still needed a
 * click would invent work that does not exist.
 */
export async function getPendingApprovals(
  db: ApprovalsDb | PrismaClient,
  installationIds: string[],
): Promise<PendingApprovalView[]> {
  if (installationIds.length === 0) return [];

  const rows = (await (db as ApprovalsDb).approvalPrompt.findMany({
    where: {
      status: 'PENDING',
      executedAt: null,
      review: { repository: { installationId: { in: installationIds } } },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: {
      review: {
        select: { prNumber: true, repository: { select: { fullName: true } } },
      },
    },
  })) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const review = (r.review ?? {}) as {
      prNumber?: unknown;
      repository?: { fullName?: unknown } | null;
    };
    return {
      id: String(r.id),
      command: String(r.command),
      reason: String(r.reason),
      createdAt: new Date(r.createdAt as string | Date).toISOString(),
      repositoryFullName:
        typeof review.repository?.fullName === 'string'
          ? review.repository.fullName
          : 'unknown repository',
      prNumber: typeof review.prNumber === 'number' ? review.prNumber : 0,
    };
  });
}

/**
 * Resolve ONE approval within the caller's installations — the tenancy check
 * both mutation routes run before they act. Returns null when the id does not
 * exist OR belongs to another tenant: a cross-tenant id must read as
 * not-found, never as forbidden-but-existing (which would confirm it exists).
 */
export async function findOwnedApproval(
  db: ApprovalsDb | PrismaClient,
  installationIds: string[],
  id: string,
): Promise<{ id: string; status: string; executedAt: Date | null } | null> {
  if (installationIds.length === 0) return null;

  const rows = (await (db as ApprovalsDb).approvalPrompt.findMany({
    where: {
      id,
      review: { repository: { installationId: { in: installationIds } } },
    },
    take: 1,
  })) as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    status: String(row.status),
    executedAt: row.executedAt ? new Date(row.executedAt as string | Date) : null,
  };
}
