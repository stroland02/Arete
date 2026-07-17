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
import { resolveSelectedInstallationIds } from '@/lib/queries';
import type { ProbeResult } from './model-connections-map';

export { toView, classifyTestOutcome } from './model-connections-map';
export type { ModelConnectionView, ProbeResult, TestHttp } from './model-connections-map';

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

/** Proxy the provider probe to the webhook's SSRF-guarded internal endpoint.
 *  Never throws — an unreachable probe service is reported as a failed result. */
export async function probeModelConnection(input: {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<ProbeResult> {
  const base = process.env.WEBHOOK_SERVICE_URL;
  if (!base) return { ok: false, detail: 'unreachable: probe service not configured' };
  try {
    const res = await fetch(`${base}/internal/model-connections/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { ok: false, detail: `unreachable: probe service ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: body.ok === true,
      model: typeof body.model === 'string' ? body.model : undefined,
      detail: typeof body.detail === 'string' ? body.detail : undefined,
    };
  } catch {
    return { ok: false, detail: 'unreachable: could not reach probe service' };
  }
}
