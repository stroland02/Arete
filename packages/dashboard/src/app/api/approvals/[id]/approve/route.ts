/**
 * POST /api/approvals/[id]/approve — a human authorizes a paused agent's
 * infrastructure command.
 *
 * This is the session-scoped PROXY the approval gate was missing. The real
 * execute endpoint lives on the webhook and is protected by the internal
 * token (`requireInternalToken`), so a browser cannot and must not call it
 * directly. This route is the only thing that bridges the two: it
 *
 *   1. authenticates the SESSION,
 *   2. resolves the approval WITHIN the caller's installations — a prompt
 *      belonging to another tenant reads as 404, never as 403, so the response
 *      never confirms that someone else's approval exists,
 *   3. forwards to the webhook with internal-token headers.
 *
 * The webhook remains the authority: it owns the PENDING->EXECUTED transition,
 * the refusal to run a REJECTED command, and the conditional update that makes
 * two concurrent clicks enqueue the command exactly once. Nothing is decided
 * here, and no outcome is invented — statuses map 1:1 from the upstream reply.
 *
 * WEBHOOK_SERVICE_URL unset => 503 with an honest "not wired in this
 * environment", never a same-origin fallback that would 404 and read as a
 * different, misleading truth (the /api/containers/[id]/send precedent).
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { findOwnedApproval } from '@/lib/approvals';
import { internalAuthHeaders } from '@/lib/internal-auth';

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

  const owned = await findOwnedApproval(db, installationIds, id);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (owned.status === 'REJECTED') {
    // A rejected command must never run. Refuse here as well as upstream:
    // the gate is cheap to state twice and expensive to get wrong once.
    return NextResponse.json({ error: 'rejected', status: owned.status }, { status: 409 });
  }

  const base = process.env.WEBHOOK_SERVICE_URL;
  if (!base) {
    return NextResponse.json({ error: 'approvals_not_configured' }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/approvals/${encodeURIComponent(id)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await internalAuthHeaders()) },
      body: JSON.stringify({}),
    });
  } catch (err) {
    console.error(`[approvals/approve] upstream call failed for ${id}:`, err);
    return NextResponse.json({ error: 'upstream_unreachable' }, { status: 502 });
  }

  let body: unknown = null;
  try {
    body = await upstream.json();
  } catch {
    /* non-JSON upstream body — the status alone carries the outcome */
  }

  // Mirror the upstream status verbatim. Inventing a friendlier one here would
  // make the UI claim something the system did not do.
  return NextResponse.json(
    (body as Record<string, unknown>) ?? { error: 'upstream_error' },
    { status: upstream.status },
  );
}
