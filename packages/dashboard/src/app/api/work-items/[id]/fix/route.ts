import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireScope } from '@/lib/model-connections-api';
import { internalAuthHeaders } from '@/lib/internal-auth';

// Session-scoped; never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * POST /api/work-items/[id]/fix — "Fix it" / "Implement it": turn a selected
 * work item into an IssueContainer at the pipeline's real initial state
 * (`detecting`) and dispatch the fix drive (webhook /fix/trigger → agents /fix),
 * which authors + verifies a real patch and advances the container to `ready`
 * (or `fix_failed`). One PR per work item, on branch kuma/<kind>-<id8>.
 *
 * Tenancy: the item is read with BOTH id AND the session-derived installation
 * scope — a cross-tenant id reads as not-found (404), never as forbidden-but-
 * existing. Only an `open` item can start fixing (409 otherwise; a dismissal is
 * a decision). The container is born from the item's REAL evidence and starts
 * unapproved (gates.solutionApprovedAt: null) — the HITL moat is untouched.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const scope = await requireScope();
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const item = await db.workItem.findFirst({
    where: { id, installationId: { in: scope.installationIds } },
  });
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (item.state !== 'open') {
    return NextResponse.json({ error: 'not_open', state: item.state }, { status: 409 });
  }

  // PR target from the tenant's connected repo (owner/repo from fullName).
  const repo = await db.repository.findFirst({
    where: { installationId: item.installationId },
    orderBy: { createdAt: 'asc' },
    select: { fullName: true },
  });
  if (!repo) return NextResponse.json({ error: 'no_repository' }, { status: 409 });
  const [owner, ...rest] = repo.fullName.split('/');
  const target = { owner: owner ?? '', repo: rest.join('/') };

  const branch = `kuma/${item.kind}-${item.id.slice(0, 8)}`;
  const container = await db.issueContainer.create({
    data: {
      installationId: item.installationId,
      // The pipeline's REAL initial state — the fix drive advances it from here
      // (detecting → fanning_out → ready). `open` is not a ContainerState and
      // could never reach `ready`/approval.
      state: 'detecting',
      gates: { solutionApprovedAt: null },
      target,
      pr: {
        base: 'main',
        branch,
        title: item.title,
        body: item.detail,
      },
      patch: [],
      findings: item.evidence ?? [],
    },
  });

  await db.workItem.update({
    where: { id: item.id },
    data: { state: 'fixing', containerId: container.id },
  });

  // Dispatch the fix drive (fire-and-forget): the webhook authors + verifies a
  // real patch and advances the container to `ready`/`fix_failed`, persisting a
  // live transcript the console streams. A drive failure lands the container in
  // fix_failed on its own — never surfaced as a fix-route error, so the UI can
  // open the live stream immediately with the containerId below.
  const base = process.env.WEBHOOK_SERVICE_URL;
  if (base) {
    try {
      await fetch(`${base}/fix/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
        body: JSON.stringify({ workItemId: item.id }),
      });
    } catch (err) {
      // The container exists and the item is `fixing`; the drive can be retried.
      console.error(`[work-items/fix] dispatch to /fix/trigger failed for ${item.id}:`, err);
    }
  }

  return NextResponse.json({ containerId: container.id }, { status: 200 });
}
