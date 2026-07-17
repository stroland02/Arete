import { NextResponse, type NextRequest } from 'next/server';
import {
  requireScope,
  probeModelConnection,
  classifyTestOutcome,
} from '@/lib/model-connections-api';

// Session-scoped; never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * POST /api/model-connections/test — validate a candidate { provider, model,
 * apiKey?, baseUrl? } without persisting anything. The probe runs in the webhook
 * service (SSRF-guarded); we map its result to the status codes the AI-Models
 * client turns into connected / unauthorized / unreachable / failed.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const scope = await requireScope();
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!provider || !model) {
    return NextResponse.json({ ok: false, error: 'provider and model are required' }, { status: 400 });
  }
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined;
  const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl ? body.baseUrl : undefined;

  const probe = await probeModelConnection({ provider, model, apiKey, baseUrl });
  const mapped = classifyTestOutcome(probe);
  return NextResponse.json(mapped.body, { status: mapped.status });
}
