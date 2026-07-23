/**
 * POST /api/findings/[id]/noise — a human silences, or restores, one review
 * finding.
 *
 * This is the first and only writer of `ReviewComment.noiseState` in the
 * dashboard. The column has existed since
 * `20260714120000_add_review_comment_noise_fields`, and until now only machines
 * wrote it: `packages/webhook/src/persistence.ts` escalates a recurring
 * `UNDER_OBSERVATION` finding, and the Python orchestrator can silence one. A
 * human could see neither the state nor a way to change it, so the noise loop
 * had no human end — Stage 1.4 of the reachability roadmap.
 *
 * ## What a human may set, and what stays the machine's
 *
 * `OPEN` and `SILENCED` only. `UNDER_OBSERVATION` and `ESCALATED` are states
 * the escalation machine derives from recurrence across pull requests; letting
 * a button assert one would be claiming an observation that never happened.
 * Restoring therefore returns a finding to `OPEN`, NOT to whatever state
 * preceded the silence — that prior state is recorded nowhere, and picking a
 * plausible one would be fabricated status. `occurrenceCount` is never touched,
 * so recurrence history survives a silence/restore round-trip intact.
 *
 * ## What silencing actually does, and what it honestly cannot undo
 *
 * Silenced findings drop out of `getFindingsByPath` (`noiseState: 'OPEN'`), so
 * they stop driving the code map's pain signal, and they are excluded from the
 * copy-for-agent prompt. What it does NOT do is retract a comment already
 * posted to GitHub: `comment-poster.ts` filters on `noiseState` at post time,
 * which has already passed. Silencing is forward-acting, and the UI says so.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The only two states a human may assert. See the module comment. */
const HUMAN_SETTABLE = new Set(['OPEN', 'SILENCED']);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const installationIds = (session.installations ?? []).map((i) => i.id);
  if (installationIds.length === 0) {
    // No installations means nothing is in scope to update. Not-found rather
    // than forbidden, for the same reason as the cross-tenant case below.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let state: unknown;
  try {
    state = ((await req.json()) as { state?: unknown } | null)?.state;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (typeof state !== 'string' || !HUMAN_SETTABLE.has(state)) {
    // Rejecting UNDER_OBSERVATION/ESCALATED here is deliberate, not an
    // oversight: those are the machine's to assign.
    return NextResponse.json(
      { error: 'invalid_state', allowed: [...HUMAN_SETTABLE] },
      { status: 400 },
    );
  }

  // Scoped by tenancy in the WHERE clause itself, so a finding belonging to
  // another installation matches nothing and is reported as absent — the
  // response never confirms the existence of a row the caller may not see.
  const { count } = await db.reviewComment.updateMany({
    where: {
      id,
      review: { repository: { installationId: { in: installationIds } } },
    },
    data: { noiseState: state },
  });

  if (count === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ id, noiseState: state }, { status: 200 });
}
