// The two primitives that START a fix run, in ONE place. Before this module
// there were three near-identical copies of "open an IssueContainer, flip the
// WorkItem to `fixing`, POST /fix/trigger": the "Fix it" route
// (work-items/[id]/fix/route.ts), the Alertmanager routing path
// (webhook alerting/incident.ts — a different SERVICE, so it keeps its own
// copy), and now the manual-investigation auto-start (lib/incidents.ts). Two of
// those three live in this dashboard, so they share these functions rather than
// drift apart — a fix run that opens differently in two places is a fix run
// that fails differently in two places.
//
// HITL is preserved (Global Constraint 5): the container is born UNAPPROVED
// (`gates.solutionApprovedAt: null`) at the pipeline's real initial state
// (`detecting`). Opening a run authors and verifies a patch and halts at
// `ready`; nothing here can merge, apply, or post.

import type { PrismaClient } from '@arete/db';

/** Prisma delegates `openFixContainer` touches. Structural so tests inject a
 *  fake and callers pass the real client (same pattern as lib/incidents.ts). */
type FixContainerDb = {
  issueContainer: { create(args: unknown): Promise<{ id: string }> };
  workItem: { update(args: unknown): Promise<unknown> };
};

export interface OpenFixContainerInput {
  installationId: string;
  /** WorkItem.kind — used only for the PR branch slug (`kuma/<kind>-<id8>`). */
  kind: string;
  /** The WorkItem this run heals; also the branch-slug seed. */
  workItemId: string;
  target: { owner: string; repo: string };
  /** PR title / body — the WorkItem's own title and detail. */
  title: string;
  detail: string;
  /** Seed findings for the container (a WorkItem's evidence, or [] when there
   *  is none — e.g. a manual investigation). */
  findings: unknown[];
}

/**
 * Opens an IssueContainer at the pipeline's real initial state and flips its
 * WorkItem to `fixing`, exactly as the "Fix it" route always has. Returns the
 * new container id. Callers own their own guards (auth, tenancy scope, state,
 * cooldown, repo presence) BEFORE calling — this is the shared tail, not the
 * gate.
 */
export async function openFixContainer(
  db: FixContainerDb | PrismaClient,
  input: OpenFixContainerInput,
): Promise<{ containerId: string }> {
  const container = await (db as FixContainerDb).issueContainer.create({
    data: {
      installationId: input.installationId,
      // The pipeline's REAL initial state — the fix drive advances it from here
      // (detecting → fanning_out → ready). `open` is not a ContainerState.
      state: 'detecting',
      gates: { solutionApprovedAt: null },
      target: input.target,
      pr: {
        base: 'main',
        branch: `kuma/${input.kind}-${input.workItemId.slice(0, 8)}`,
        title: input.title,
        body: input.detail,
      },
      patch: [],
      findings: input.findings,
    },
  });

  await (db as FixContainerDb).workItem.update({
    where: { id: input.workItemId },
    data: { state: 'fixing', containerId: container.id },
  });

  return { containerId: container.id };
}

/**
 * Fire-and-forget dispatch of the fix drive to the webhook (`/fix/trigger`).
 * The container already exists and the WorkItem is `fixing`, so a dispatch
 * failure is logged and swallowed — never surfaced as a fix-start error — and
 * the drive can be retried. A missing WEBHOOK_SERVICE_URL is a no-op (the
 * dashboard can run without the webhook wired up, e.g. in tests).
 */
export async function dispatchFixTrigger(workItemId: string): Promise<void> {
  const base = process.env.WEBHOOK_SERVICE_URL;
  if (!base) return;
  const { internalAuthHeaders } = await import('@/lib/internal-auth');
  try {
    await fetch(`${base}/fix/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await internalAuthHeaders()) },
      body: JSON.stringify({ workItemId }),
    });
  } catch (err) {
    console.error(`[fix-dispatch] dispatch to /fix/trigger failed for ${workItemId}:`, err);
  }
}
