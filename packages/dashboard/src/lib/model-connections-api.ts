// Server-side helpers for the /api/model-connections routes (Wave-2 AI Models).
//
// Tenant scoping is derived ENTIRELY from the signed-in session's authorized
// installations (resolveSelectedInstallationIds) — the client never supplies an
// installationId, and we never trust one if it did. Secrets are encrypted with
// the shared scheme (telemetry-credentials, TELEMETRY_ENCRYPTION_KEY) and are
// never returned by list/get. The SSRF-sensitive provider probe runs in the
// webhook service (net-guard); we proxy to it rather than fetch a
// customer-supplied baseUrl from the Next.js server.
//
// Pure mapping helpers (toView / classifyTestOutcome) live in
// ./model-connections-map so they stay unit-testable without auth/db; they are
// re-exported here so the routes have a single import surface.

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { internalAuthHeaders } from '@/lib/internal-auth';
import { decryptCredentials } from '@/lib/telemetry-credentials';
import { resolveSelectedInstallationIds } from '@/lib/queries';
import type { ProbeResult, ActiveModelConnection } from './model-connections-map';

export { toView, classifyTestOutcome } from './model-connections-map';
export type { ModelConnectionView, ProbeResult, TestHttp, ActiveModelConnection } from './model-connections-map';

export interface SessionScope {
  /** The caller's authorized Installation ids (internal uuids). */
  installationIds: string[];
}

/** Resolve the caller's authorized installation ids, or null if unauthenticated.
 *  NEVER trusts a client-supplied installationId — scope comes from the session. */
export async function requireScope(): Promise<SessionScope | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { installationIds: resolveSelectedInstallationIds(session.installations ?? [], undefined) };
}

/**
 * The session's active model connection — the newest one across the caller's
 * authorized installations, or null when none is configured. "Newest = active"
 * mirrors resolveModelConnectionForReview (webhook), so what the sidebar shows
 * is exactly what a review runs on. Never throws; returns null on any failure.
 */
export async function getActiveModelConnection(): Promise<ActiveModelConnection | null> {
  try {
    const scope = await requireScope();
    if (!scope || scope.installationIds.length === 0) return null;
    const row = await db.modelConnection.findFirst({
      where: { installationId: { in: scope.installationIds } },
      orderBy: { createdAt: 'desc' },
      select: { provider: true, model: true },
    });
    return row ? { provider: row.provider, model: row.model } : null;
  } catch {
    return null;
  }
}

/** The full `llm` block a request runs on — camelCase, mirroring the agents
 *  Pydantic LlmConfig (everything but provider optional). */
export interface LlmBlock {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Resolve the session's connected model into the `llm` block agent chat runs on
 * — the SAME newest-connection convention reviews use, so chat and reviews run
 * on the same model. Decrypts the stored key for API-key providers; keyless
 * (Ollama) omits it. Returns null when nothing is connected (caller then runs on
 * the service default). Never throws.
 */
export async function resolveActiveLlmForChat(): Promise<LlmBlock | null> {
  try {
    const scope = await requireScope();
    if (!scope || scope.installationIds.length === 0) return null;
    const row = await db.modelConnection.findFirst({
      where: { installationId: { in: scope.installationIds } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    const apiKey = row.apiKeyEncrypted
      ? decryptCredentials<{ apiKey: string }>(row.apiKeyEncrypted).apiKey
      : undefined;
    return {
      provider: row.provider,
      model: row.model,
      ...(apiKey ? { apiKey } : {}),
      ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
    };
  } catch {
    return null;
  }
}

/** Proxy the provider probe to the webhook's SSRF-guarded internal endpoint.
 *  Never throws — an unreachable probe service is reported as a failed result. */
export async function probeModelConnection(input: {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<ProbeResult> {
  const base = process.env.WEBHOOK_SERVICE_URL;
  // Debug feed: the running process's actual WEBHOOK_SERVICE_URL — if this
  // shows :3000 (the dashboard itself) instead of the webhook's :3001, the
  // process was started with a stale env and needs a restart.
  console.warn(`[model-connections/probe] provider=${input.provider} model=${input.model} -> WEBHOOK_SERVICE_URL=${base ?? '(unset)'}`);
  if (!base) return { ok: false, detail: 'unreachable: probe service not configured' };
  try {
    const res = await fetch(`${base}/internal/model-connections/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...internalAuthHeaders() },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      console.error(`[model-connections/probe] probe service returned ${res.status} from ${base}/internal/model-connections/test`);
      return { ok: false, detail: `unreachable: probe service ${res.status}` };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.warn(`[model-connections/probe] result ok=${body.ok === true} detail=${body.detail ?? '-'}`);
    return {
      ok: body.ok === true,
      model: typeof body.model === 'string' ? body.model : undefined,
      detail: typeof body.detail === 'string' ? body.detail : undefined,
    };
  } catch (err) {
    console.error(`[model-connections/probe] could not reach ${base}:`, err instanceof Error ? err.message : err);
    return { ok: false, detail: 'unreachable: could not reach probe service' };
  }
}
