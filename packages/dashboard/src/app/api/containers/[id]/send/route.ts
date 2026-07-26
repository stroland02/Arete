/**
 * POST /api/containers/[id]/send — the SECOND human gate: send the approved
 * solution as a real pull request. Wave-2 Part B.
 *
 * This is the server-side Send-PR action: it drives the typed StagingClient
 * against the real webhook service (POST /staging/send). The HITL moat holds on
 * BOTH sides — this route refuses to call unless the STORED container has cleared
 * the solution gate (canPost: state solution_approved AND gates.solutionApprovedAt
 * set), and the webhook independently re-checks and answers not_approved (409).
 * Nothing here auto-sends: a human must have approved, and a human clicks Send.
 *
 * Outcome mapping is honest — the transport contract 1:1, no fabricated success:
 *   opened | already_open → 200 (idempotent re-send returns the same PR)
 *   not_approved → 409 · not_found → 404 · bad_request → 400 · failed → 502
 * On a real open, the container is advanced to `posted` (postedAt/By stamped).
 *
 * The webhook base URL is injected via STAGING_SERVICE_URL. Unset → 503
 * staging_not_configured (an honest "not wired here", never a silent wrong-origin
 * call that masquerades as a result).
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PrismaContainerStore, type StoredContainer } from "@/lib/issue-pipeline/container-persistence";
import { canPost } from "@/lib/issue-pipeline/pipeline";
import { internalAuthHeaders } from "@/lib/internal-auth";
import { HttpStagingClient, type StagingOutcome } from "@/lib/issue-pipeline/staging-client";
import type { IssueContainer } from "@/lib/issue-pipeline/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function httpStatusFor(outcome: StagingOutcome["status"]): number {
  switch (outcome) {
    case "opened":
    case "already_open":
      return 200;
    case "not_approved":
      return 409;
    case "not_found":
      return 404;
    case "bad_request":
      return 400;
    case "failed":
      return 502;
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const installationIds = (session.installations ?? []).map((i) => i.id);

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

  // Defense-in-depth HITL gate against STORED state: never send an un-approved
  // container, even though the webhook also enforces this. canPost reads only
  // .state + .gates, so pass those through the single-sourced pipeline rule.
  if (!canPost({ state: stored.state, gates: stored.gates } as IssueContainer)) {
    return Response.json({ error: "not_approved", state: stored.state }, { status: 409 });
  }

  const baseUrl = process.env.STAGING_SERVICE_URL;
  if (!baseUrl) {
    // Honest "not wired in this environment" — do NOT fall back to a same-origin
    // call that would 404 and read as not_found (a different, misleading truth).
    return Response.json({ error: "staging_not_configured" }, { status: 503 });
  }

  const client = new HttpStagingClient({ baseUrl, headers: await internalAuthHeaders() });
  const outcome = await client.send({ containerId: id, installationId: owningInstallationId });

  // On a real open, advance the persisted lifecycle to `posted`. Idempotent
  // re-sends (already_open) also stamp posted — the PR IS open.
  if (outcome.status === "opened" || outcome.status === "already_open") {
    const postedBy = session.user.email ?? session.user.name ?? "unknown";
    await store.save(id, owningInstallationId, {
      state: "posted",
      gates: { ...stored.gates, postedAt: new Date().toISOString(), postedBy },
    });
  }

  return Response.json({ outcome }, { status: httpStatusFor(outcome.status) });
}
