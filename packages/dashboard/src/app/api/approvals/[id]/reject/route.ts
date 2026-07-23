/**
 * POST /api/approvals/[id]/reject — a human refuses a paused agent's
 * infrastructure command.
 *
 * The REJECTED status was already load-bearing before this route existed:
 * `executeApproval` (packages/webhook/src/approval-handler.ts) refuses to run a
 * REJECTED command. Nothing in the system could ever WRITE that status, so the
 * refusal path was unreachable and "no" was not an answer a human could give.
 *
 * Unlike approve, this needs no webhook round-trip: rejecting runs nothing, so
 * there is no command to hand to the `approval-exec` queue. It is a single
 * durable state change, written here.
 *
 * The update is CONDITIONAL — scoped by tenancy AND by `executedAt: null`. An
 * approval that has already been actioned cannot be retroactively rejected,
 * and the condition is what makes an approve/reject race resolve to exactly
 * one outcome rather than to whichever write landed last. Zero rows updated is
 * reported as a conflict, never as a success.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { findOwnedApproval } from '@/lib/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const installationIds = (session.installations ?? []).map((i) => i.id);

  // Cross-tenant or absent both read as not-found — the response never
  // confirms the existence of an approval the caller may not see.
  const owned = await findOwnedApproval(db, installationIds, id);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (owned.status === 'REJECTED') {
    // Idempotent: re-rejecting an already-rejected approval is the state the
    // caller asked for, so report success rather than a spurious conflict.
    return NextResponse.json({ id, status: 'REJECTED', already: true }, { status: 200 });
  }

  const { count } = await db.approvalPrompt.updateMany({
    where: {
      id,
      executedAt: null,
      review: { repository: { installationId: { in: installationIds } } },
    },
    data: { status: 'REJECTED' },
  });

  if (count === 0) {
    // Actioned between the read and the write — the command is already running
    // or has run. Saying "rejected" here would be a lie about what happened.
    return NextResponse.json({ error: 'already_executed' }, { status: 409 });
  }

  return NextResponse.json({ id, status: 'REJECTED', already: false }, { status: 200 });
}
