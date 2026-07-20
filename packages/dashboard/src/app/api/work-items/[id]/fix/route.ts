import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { internalAuthHeaders } from '@/lib/internal-auth';
import { requireScope } from '@/lib/model-connections-api';

// Session-scoped; never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * POST /api/work-items/[id]/fix — "Fix it" / "Implement it": birth a REAL
 * IssueContainer at the pipeline's initial state (`detecting`, spec 2026-07-19
 * §2/§4) from the item's payload, mark the item `fixing`, and dispatch the fix
 * run via the webhook's bearer-guarded /fix/trigger (body = { workItemId }
 * only — the webhook re-derives tenancy from the stored row). A failed
 * dispatch reverts honestly: container → fix_failed, item → open + fixError,
 * 502 — never a phantom "fixing" item with no run behind it.
 *
 * Tenancy: the item is read with BOTH id AND the session-derived installation
 * scope — a cross-tenant id reads as not-found (404), never as forbidden-but-
 * existing. Only an `open` item can start fixing (409 otherwise; a dismissal is
 * a decision). The container starts unapproved (all gates null) — the HITL
 * moat is untouched; the worker parks at `ready`.
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
  // Born at the pipeline's REAL initial state — never 'open'. The worker
  // advances it; gates start fully null (only the human approve stamps them).
  const container = await db.issueContainer.create({
    data: {
      installationId: item.installationId,
      state: 'detecting',
      gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
      target,
      pr: {
        base: 'main',
        branch,
        title: item.title,
        body: item.detail,
      },
      patch: [],
      findings: item.evidence ?? [],
      transcript: [],
    },
  });

  await db.workItem.update({
    where: { id: item.id },
    data: { state: 'fixing', containerId: container.id, fixError: null },
  });

  // Dispatch the real fix run (spec §2). Body carries ONLY the work-item id;
  // the webhook re-derives installation + container from the stored row. A
  // dispatch that does not land (unreachable, unconfigured, non-202) reverts
  // honestly so the inbox never shows a "fixing" item with no run behind it.
  let dispatched = false;
  const base = process.env.WEBHOOK_SERVICE_URL;
  if (base) {
    try {
      const res = await fetch(`${base}/fix/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
        body: JSON.stringify({ workItemId: item.id }),
      });
      dispatched = res.status === 202;
    } catch {
      dispatched = false;
    }
  }
  if (!dispatched) {
    await db.issueContainer.updateMany({
      where: { id: container.id, installationId: item.installationId },
      data: { state: 'fix_failed' },
    });
    await db.workItem.update({
      where: { id: item.id },
      data: {
        state: 'open',
        fixError: 'Fix dispatch failed — the fix service is unreachable. Retry when it is back.',
      },
    });
    return NextResponse.json({ error: 'fix_dispatch_failed' }, { status: 502 });
  }

  return NextResponse.json({ containerId: container.id }, { status: 200 });
}
