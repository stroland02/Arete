import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { internalAuthHeaders } from '@/lib/internal-auth';
import { encryptCredentials } from '@/lib/telemetry-credentials';
import {
  requireScope,
  toView,
  probeModelConnection,
  classifyTestOutcome,
} from '@/lib/model-connections-api';

// Session-scoped; never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * GET /api/model-connections — list the caller's model connections (across their
 * authorized installations) as key-free views. Empty list when none configured;
 * the AI-Models client treats a non-200 as "not configured".
 */
export async function GET(): Promise<Response> {
  const scope = await requireScope();
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db.modelConnection.findMany({
    where: { installationId: { in: scope.installationIds } },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json(rows.map(toView));
}

/**
 * POST /api/model-connections — connect (upsert) a model for the caller's
 * primary installation. Validate-then-write: a key-bearing connection is probed
 * first and a bad key NEVER persists. Keyless (Ollama) connections skip the probe.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const scope = await requireScope();
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const target = scope.installationIds[0];
  if (!target) return NextResponse.json({ error: 'Install the GitHub App first' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
  const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl ? body.baseUrl : null;
  if (!provider || !model) {
    return NextResponse.json({ error: 'provider and model are required' }, { status: 400 });
  }

  // Test never persists a bad key.
  if (apiKey) {
    const probe = await probeModelConnection({ provider, model, apiKey, baseUrl: baseUrl ?? undefined });
    if (!probe.ok) {
      const mapped = classifyTestOutcome(probe);
      // A rejected credential must not persist — surface a non-2xx so the
      // client's connect() rejects rather than showing a phantom Connected.
      return NextResponse.json(mapped.body, { status: mapped.status === 200 ? 422 : mapped.status });
    }
  }

  // Connecting a model (re)ACTIVATES it: the active model everywhere is the
  // newest ModelConnection (resolveActiveLlmForChat / resolveModelConnectionForReview,
  // orderBy createdAt desc). Bumping createdAt on re-connect makes "Connect" mean
  // "use this one now", so switching providers is a single click.
  //
  // KEY SAFETY: only overwrite the stored (encrypted) key when a NEW key is
  // provided. Re-connecting a saved api-key provider WITHOUT re-entering the key
  // (e.g. to promote it) must PRESERVE the existing key — providers don't
  // re-issue keys, so a null overwrite would be an unrecoverable loss.
  const update: {
    model: string;
    baseUrl: string | null;
    createdAt: Date;
    apiKeyEncrypted?: string | null;
  } = { model, baseUrl, createdAt: new Date() };
  if (apiKey) update.apiKeyEncrypted = encryptCredentials({ apiKey });
  const row = await db.modelConnection.upsert({
    where: { installationId_provider: { installationId: target, provider } },
    create: {
      installationId: target,
      provider,
      model,
      baseUrl,
      apiKeyEncrypted: apiKey ? encryptCredentials({ apiKey }) : null,
    },
    update,
  });

  // Auto-scan on connect (work-item inbox): connecting a model may complete the
  // repo+model pair, so poke the webhook scan trigger fire-and-forget. The
  // trigger re-checks all gates server-side; a failure here must never fail the
  // connect itself.
  const webhookBase = process.env.WEBHOOK_SERVICE_URL;
  if (webhookBase) {
    const scanAuthHeaders = await internalAuthHeaders();
    void fetch(`${webhookBase}/scan/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...scanAuthHeaders },
      body: JSON.stringify({ installationId: target }),
    }).catch(() => {});
  }

  return NextResponse.json(toView(row));
}
