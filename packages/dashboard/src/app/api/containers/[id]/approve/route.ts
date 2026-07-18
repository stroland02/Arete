/**
 * POST /api/containers/[id]/approve — cross the FIRST human gate: the solution
 * approval (ready → solution_approved). Wave-2 ③ + Part A.
 *
 * The HITL moat, enforced HERE on the backend against STORED state (not merely
 * disabled in the UI, and not trusting anything in the request): the driver
 * leaves a composed container at `ready` and never advances it; only this
 * deliberate human action crosses the line. The gate is now checked against the
 * persisted IssueContainer row and the approval is WRITTEN BACK, so Eng1's
 * loadApprovedContainer sees a real `gates.solutionApprovedAt` at send time.
 *
 *   • stored container not found for this tenant → 404
 *   • stored state is not `ready`                 → 409 (server is the authority)
 *   • otherwise → stamp gates.solutionApprovedAt/By in the DB, return 200
 *
 * It never posts a PR — that is the SECOND gate (Services / StagingClient).
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PrismaContainerStore, type StoredContainer } from "@/lib/issue-pipeline/container-persistence";
import { canApprove } from "@/lib/issue-pipeline/pipeline";
import type { IssueContainer } from "@/lib/issue-pipeline/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const installationIds = (session.installations ?? []).map((i) => i.id);

  // Resolve the stored container within the caller's own installations only —
  // the read is tenancy-scoped (findFirst on id + installationId), so a
  // container belonging to another tenant is simply not found here.
  const store = new PrismaContainerStore(db);
  let stored: StoredContainer | null = null;
  let owningInstallationId: string | null = null;
  for (const instId of installationIds) {
    stored = await store.load(id, instId);
    if (stored) {
      owningInstallationId = instId;
      break;
    }
  }
  if (!stored || !owningInstallationId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Server-enforced gate against STORED state: refuse anything not at `ready`.
  // canApprove reads only `.state`; pass the stored state through it so the rule
  // stays single-sourced in the pipeline.
  if (!canApprove({ state: stored.state } as IssueContainer)) {
    return Response.json({ error: "not_ready", state: stored.state }, { status: 409 });
  }

  const approver = session.user.email ?? session.user.name ?? "unknown";
  const at = new Date().toISOString();
  const gates = { ...stored.gates, solutionApprovedAt: at, solutionApprovedBy: approver };

  const saved = await store.save(id, owningInstallationId, { state: "solution_approved", gates });
  if (!saved) {
    // A concurrent write moved/removed the row between load and save.
    return Response.json({ error: "not_found" }, { status: 404 });
  }

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

  return Response.json(
    { container: { id, installationId: owningInstallationId, state: "solution_approved", gates } },
    { status: 200 },
  );
}
