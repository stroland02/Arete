/**
 * POST /api/containers/[id]/approve — cross the FIRST human gate: the solution
 * approval (ready → solution_approved). Wave-2 ③.
 *
 * This is the HITL moat, enforced HERE on the backend (not merely disabled in the
 * UI): the driver leaves a composed container at `ready` and never advances it;
 * only this deliberate human action, checked against `canApprove`, crosses the
 * line. A container not in `ready` is refused with 409 — the UI can trigger
 * without knowing the state, because the server is the authority.
 *
 * PERSISTENCE SEAM: the approved transition is computed and returned, but durable
 * persistence lands with the persistent IssueContainer store (a pending
 * integration dependency). Until then this enforces the gate and echoes the
 * approved container; it does not yet write it back. It never posts a PR — that
 * is the SECOND gate (Services / StagingClient), intentionally still inert.
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getLiveSampleContainer } from "@/lib/issue-pipeline/live-drive";
import { approveSolution, canApprove } from "@/lib/issue-pipeline/pipeline";
import { getReviewContainer } from "@/lib/issue-pipeline/review-container-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const installationIds = (session.installations ?? []).map((i) => i.id);
  const container = (await getReviewContainer(db, installationIds, id)) ?? getLiveSampleContainer(id);
  if (!container) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Server-enforced gate: refuse anything that has not reached `ready`.
  if (!canApprove(container)) {
    return Response.json({ error: "not_ready", state: container.state }, { status: 409 });
  }

  const approver = session.user.email ?? session.user.name ?? "unknown";
  const approved = approveSolution(container, approver);

  // Work-item inbox hook: a human approving this container's solution is the
  // moment its work item leaves "fixing" — the staged PR now awaits Send.
  // Tenant-scoped and non-fatal: the approval outcome never depends on it.
  try {
    await db.workItem.updateMany({
      where: { containerId: id, installationId: { in: installationIds }, state: "fixing" },
      data: { state: "staged" },
    });
  } catch (err) {
    console.error(`[approve] work-item staged hook failed for container ${id} (non-fatal):`, err);
  }

  return Response.json({ container: approved }, { status: 200 });
}
