import { NextResponse } from 'next/server';
import { listEndpointsForSession, createEndpointForSession } from '@/lib/webhook-endpoints-api';

// Session-scoped; never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * GET /api/webhooks/endpoints — the caller's outbound webhook destinations.
 *
 * Takes NO tenant parameter: the answer is derived entirely from the signed-in
 * session's own installations, so this route cannot be pointed at someone
 * else's tenant even in principle. Responses never contain the signing secret
 * (stripped on the webhook side by toPublicEndpoint, and absent from the view
 * type here).
 */
export async function GET(): Promise<Response> {
  const result = await listEndpointsForSession();
  if (!result.ok) return NextResponse.json(result.body, { status: result.status });
  return NextResponse.json({ endpoints: result.data }, { status: 200 });
}

/**
 * POST /api/webhooks/endpoints — register a destination.
 *
 * `installationId` comes from the client but is NEVER trusted: it must appear
 * in the session's own installations or the request is a 404 (never a 403 — a
 * 403 would confirm the installation exists). The destination URL is
 * SSRF-checked by the webhook service using the same guard the delivery path
 * uses; this server never fetches it.
 *
 * The 201 body carries `secret` — the ONLY time it is ever returned. No route
 * can read it back, so the UI must present it once and say so plainly.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 });

  const { installationId, url, events } = body;
  if (typeof installationId !== 'string' || typeof url !== 'string' || !Array.isArray(events)) {
    return NextResponse.json(
      { error: 'invalid_request', detail: 'installationId, url and events[] are required' },
      { status: 400 },
    );
  }

  const result = await createEndpointForSession({
    installationId,
    url,
    events: events.filter((e): e is string => typeof e === 'string'),
  });
  if (!result.ok) return NextResponse.json(result.body, { status: result.status });

  return NextResponse.json(
    { endpoint: result.data.endpoint, secret: result.data.secret },
    { status: 201 },
  );
}
