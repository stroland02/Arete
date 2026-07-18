import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireScope } from '@/lib/model-connections-api';

// Session-scoped; never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * POST /api/work-items/[id]/dismiss — the only other v1 triage action.
 * Dismissal is a decision: it is persisted, it survives re-scans (the
 * fingerprint dedup skips dismissed items), and it is only valid from `open`
 * (409 otherwise — an item already fixing/staged/posted is past triage).
 * Cross-tenant ids read as not-found, same contract as /fix.
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
    select: { id: true, state: true },
  });
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (item.state !== 'open') {
    return NextResponse.json({ error: 'not_open', state: item.state }, { status: 409 });
  }

  await db.workItem.update({
    where: { id: item.id },
    data: { state: 'dismissed' },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
