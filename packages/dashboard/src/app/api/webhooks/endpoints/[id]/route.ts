import { NextResponse } from 'next/server';
import { setEndpointEnabledForSession } from '@/lib/webhook-endpoints-api';

// Session-scoped; never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/webhooks/endpoints/[id] — enable or disable one destination.
 *
 * Two independent ownership checks, because there are two ids in play. The
 * INSTALLATION must be one of the session's own (here, via
 * setEndpointEnabledForSession). The ENDPOINT must belong to that installation,
 * re-checked in the webhook service — necessary because the underlying
 * `WebhookStore.setEnabled(id, enabled)` takes an id and nothing else and would
 * otherwise happily disable any row in the table.
 *
 * A miss on either check is a 404, identical to an id that never existed.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 });

  const { installationId, enabled } = body;
  if (typeof installationId !== 'string' || typeof enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'invalid_request', detail: 'installationId and boolean enabled are required' },
      { status: 400 },
    );
  }

  const result = await setEndpointEnabledForSession({ installationId, id, enabled });
  if (!result.ok) return NextResponse.json(result.body, { status: result.status });
  return NextResponse.json({ endpoint: result.data }, { status: 200 });
}
