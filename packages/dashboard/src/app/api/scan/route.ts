import { NextResponse } from 'next/server';
import { internalAuthHeaders } from '@/lib/internal-auth';
import { requireScope } from '@/lib/model-connections-api';

// Session-scoped; never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * POST /api/scan — manual re-scan for the caller's primary installation
 * (the Services "Scan" button). Tenant scope comes ENTIRELY from the session
 * (requireScope); a client-supplied installationId is never read. The gating
 * itself (repo present, model present, not already running) lives in the
 * webhook's /scan/trigger — this route proxies and passes its status through:
 * 202 started / 409 already_running / 200 {started:false, reason}.
 */
export async function POST(_req: Request): Promise<Response> {
  const scope = await requireScope();
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const target = scope.installationIds[0];
  if (!target) return NextResponse.json({ error: 'Install the GitHub App first' }, { status: 403 });

  const base = process.env.WEBHOOK_SERVICE_URL;
  if (!base) {
    return NextResponse.json({ error: 'scan service not configured' }, { status: 502 });
  }

  try {
    const res = await fetch(`${base}/scan/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await internalAuthHeaders()) },
      body: JSON.stringify({ installationId: target }),
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch {
    // Unreachable trigger service — report plainly, never leak connection detail.
    return NextResponse.json({ error: 'scan service unreachable' }, { status: 502 });
  }
}
