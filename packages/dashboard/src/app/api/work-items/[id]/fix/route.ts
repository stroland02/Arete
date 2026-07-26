import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireScope } from '@/lib/model-connections-api';
import { computeFixCooldown } from '@/lib/fix-cooldown';
import { openFixContainer, dispatchFixTrigger } from '@/lib/fix-dispatch';

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

  // Cooldown guard (Phase 2 Task 6): distinct from the state check above.
  // `state !== 'open'` only ever blocks while a run is actively in flight —
  // the moment driveFix's fail() path returns the item to `open`, that check
  // alone would let an immediate re-trigger through, retrying a failing fix
  // in a tight loop. 429 (not 409) is deliberate: it tells the client the
  // request itself was fine and retrying IS meaningful, just not yet.
  const cooldown = computeFixCooldown(item.fixFailureCount, item.fixFailureAt);
  if (!cooldown.allowed) {
    return NextResponse.json(
      { error: 'cooldown_active', retryAfterSeconds: cooldown.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(cooldown.retryAfterSeconds) } },
    );
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

  // Open the container + flip the item to `fixing` (shared with the manual-
  // investigation auto-start — see lib/fix-dispatch.ts). The container is born
  // from the item's REAL evidence and starts unapproved; the HITL moat is
  // untouched.
  const { containerId } = await openFixContainer(db, {
    installationId: item.installationId,
    kind: item.kind,
    workItemId: item.id,
    target,
    title: item.title,
    detail: item.detail,
    findings: (item.evidence ?? []) as unknown[],
  });

  // Dispatch the fix drive (fire-and-forget): the webhook authors + verifies a
  // real patch and advances the container to `ready`/`fix_failed`, persisting a
  // live transcript the console streams. A drive failure lands the container in
  // fix_failed on its own — never surfaced as a fix-route error, so the UI can
  // open the live stream immediately with the containerId below.
  await dispatchFixTrigger(item.id);

  return NextResponse.json({ containerId }, { status: 200 });
}
