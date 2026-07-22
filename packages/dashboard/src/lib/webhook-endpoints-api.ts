// Server-side helpers for the /api/webhooks/endpoints routes — the AUTHENTICATED
// half of outbound-webhook endpoint management.
//
// This file exists because of a specific vulnerability. The webhook service once
// served POST/GET /api/webhooks/endpoints with no authentication at all, reading
// the target tenant straight out of the request: an anonymous caller could
// register a webhook for any installation, or list any installation's endpoints
// and receive their `whsec_` signing secret (with which payloads can be forged
// that pass a receiver's signature check). Those routes were deleted, leaving
// the feature dark.
//
// The split that fixes it: the webhook service owns the data and the SSRF guard
// but has NO session, so it cannot know who is asking. The dashboard has the
// session but must not perform SSRF-sensitive fetches to customer-supplied URLs
// from the Next.js server. So — exactly as model-connections-api.ts already does
// for its provider probe — the dashboard AUTHENTICATES and the webhook service
// EXECUTES: we resolve the caller's installations from their Auth.js session,
// prove the target installation is one of them, and proxy to the token-guarded
// `/internal/webhooks/endpoints` routes.
//
// THE RULE: `installationId` is never taken on trust. It arrives from the client
// (the UI must say which installation an endpoint belongs to), and is checked
// against the session's OWN installations before any call goes out. A mismatch
// is reported as `not_found`, identical to an id that does not exist, so a probe
// cannot distinguish "not yours" from "doesn't exist" — the same posture the
// webhook-side core takes.

import { internalAuthHeaders } from '@/lib/internal-auth';
import { requireScope } from '@/lib/model-connections-api';

/** An endpoint as it crosses to the browser. NOTE the absence of `secret` —
 *  the list path never carries it, by construction on both sides. */
export interface WebhookEndpointView {
  id: string;
  installationId: string;
  url: string;
  events: string[];
  enabled: boolean;
}

export type EndpointsFailure =
  | { status: 401; body: { error: 'unauthorized' } }
  | { status: 404; body: { error: 'not_found' } }
  | { status: 400; body: { error: string; detail?: string } }
  | { status: 502; body: { error: 'upstream_unavailable' } }
  | { status: 500; body: { error: 'internal_error' } };

export type EndpointsResult<T> = { ok: true; data: T } | ({ ok: false } & EndpointsFailure);

function upstreamBase(): string | null {
  return process.env.WEBHOOK_SERVICE_URL ?? null;
}

/**
 * Resolve the caller's session and confirm `installationId` is one of theirs.
 *
 * Returns 401 when unauthenticated, and 404 — never 403 — when the id is real
 * but belongs to someone else: a 403 would confirm the installation exists.
 */
async function requireOwnedInstallation(
  installationId: string,
): Promise<{ ok: true } | ({ ok: false } & EndpointsFailure)> {
  const scope = await requireScope();
  if (!scope) return { ok: false, status: 401, body: { error: 'unauthorized' } };
  if (!installationId || !scope.installationIds.includes(installationId)) {
    return { ok: false, status: 404, body: { error: 'not_found' } };
  }
  return { ok: true };
}

/** Map the webhook service's own failure reasons onto HTTP for the browser. */
function mapUpstreamFailure(status: number, reason: unknown, detail: unknown): EndpointsFailure {
  if (status === 404) return { status: 404, body: { error: 'not_found' } };
  if (status >= 500) return { status: 502, body: { error: 'upstream_unavailable' } };
  return {
    status: 400,
    body: {
      error: typeof reason === 'string' ? reason : 'invalid_request',
      ...(typeof detail === 'string' ? { detail } : {}),
    },
  };
}

async function callUpstream(
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const base = upstreamBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        ...(await internalAuthHeaders()),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/**
 * Every endpoint across the caller's OWN installations. The client supplies no
 * tenant at all here — the answer is derived entirely from the session, so this
 * path cannot be pointed at another tenant even in principle.
 */
export async function listEndpointsForSession(): Promise<EndpointsResult<WebhookEndpointView[]>> {
  const scope = await requireScope();
  if (!scope) return { ok: false, status: 401, body: { error: 'unauthorized' } };
  if (scope.installationIds.length === 0) return { ok: true, data: [] };

  const all: WebhookEndpointView[] = [];
  for (const installationId of scope.installationIds) {
    const res = await callUpstream(
      `/internal/webhooks/endpoints?installationId=${encodeURIComponent(installationId)}`,
      { method: 'GET' },
    );
    if (!res) return { ok: false, status: 502, body: { error: 'upstream_unavailable' } };
    if (res.status !== 200) {
      const failure = mapUpstreamFailure(res.status, res.body.reason, res.body.detail);
      return { ok: false, ...failure };
    }
    const endpoints = Array.isArray(res.body.endpoints)
      ? (res.body.endpoints as WebhookEndpointView[])
      : [];
    all.push(...endpoints);
  }
  return { ok: true, data: all };
}

export interface CreateEndpointRequest {
  installationId: string;
  url: string;
  events: string[];
}

/**
 * Registers an endpoint for an installation the caller owns and returns its
 * signing secret — THE ONLY TIME it is ever returned. There is no route that
 * reads it back, so the UI must show it once and say so.
 */
export async function createEndpointForSession(
  input: CreateEndpointRequest,
): Promise<EndpointsResult<{ endpoint: WebhookEndpointView; secret: string }>> {
  const owned = await requireOwnedInstallation(input.installationId);
  if (!owned.ok) return owned;

  const res = await callUpstream('/internal/webhooks/endpoints', {
    method: 'POST',
    body: { installationId: input.installationId, url: input.url, events: input.events },
  });
  if (!res) return { ok: false, status: 502, body: { error: 'upstream_unavailable' } };
  if (res.status !== 201) {
    const failure = mapUpstreamFailure(res.status, res.body.reason, res.body.detail);
    return { ok: false, ...failure };
  }
  return {
    ok: true,
    data: {
      endpoint: res.body.endpoint as WebhookEndpointView,
      secret: String(res.body.secret ?? ''),
    },
  };
}

/** Enables/disables one endpoint of an installation the caller owns. Ownership
 *  of the ENDPOINT itself is re-checked upstream (store.setEnabled is not
 *  tenant-scoped), so both halves are guarded. */
export async function setEndpointEnabledForSession(input: {
  installationId: string;
  id: string;
  enabled: boolean;
}): Promise<EndpointsResult<WebhookEndpointView>> {
  const owned = await requireOwnedInstallation(input.installationId);
  if (!owned.ok) return owned;

  const res = await callUpstream(`/internal/webhooks/endpoints/${encodeURIComponent(input.id)}`, {
    method: 'PATCH',
    body: { installationId: input.installationId, enabled: input.enabled },
  });
  if (!res) return { ok: false, status: 502, body: { error: 'upstream_unavailable' } };
  if (res.status !== 200) {
    const failure = mapUpstreamFailure(res.status, res.body.reason, res.body.detail);
    return { ok: false, ...failure };
  }
  return { ok: true, data: res.body.endpoint as WebhookEndpointView };
}
