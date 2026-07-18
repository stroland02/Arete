// Pure mapping helpers for the model-connections routes — no auth/db/fetch, so
// they are unit-testable in isolation. The route-level helpers (session scope,
// webhook probe) live in model-connections-api.ts, which re-exports these.

export interface ModelConnectionView {
  id: string;
  provider: string;
  model: string;
  connectedAt: string;
}

/** Key-free projection — never exposes apiKeyEncrypted. */
export function toView(row: { id: string; provider: string; model: string; createdAt: Date }): ModelConnectionView {
  return { id: row.id, provider: row.provider, model: row.model, connectedAt: row.createdAt.toISOString() };
}

/** The session's currently-active model: provider + model. Pure type, safe to
 *  import into client components (the sidebar chip) — no server dependency. */
export interface ActiveModelConnection {
  provider: string;
  model: string;
}

export interface ProbeResult {
  ok: boolean;
  model?: string;
  detail?: string;
}

export interface TestHttp {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Map a probe result to the HTTP status the AI-Models client (model-connections-
 * client.ts) turns into a ModelTestOutcome:
 *   200 { ok:true, model }  → connected
 *   401/403                 → unauthorized (credential rejected)
 *   502/503/504             → unreachable (host/base-url down)
 *   200 { ok:false, error } → failed
 */
export function classifyTestOutcome(result: ProbeResult): TestHttp {
  if (result.ok) return { status: 200, body: { ok: true, model: result.model } };
  const detail = result.detail ?? '';
  if (/^40[13]\b/.test(detail) || /unauthor|invalid api key|forbidden|invalid_api_key/i.test(detail)) {
    return { status: 401, body: { ok: false, error: detail } };
  }
  if (/unreachable|blocked|private address|not allowed|could not resolve|ENOTFOUND|ECONNREFUSED|fetch failed|network|timed out|timeout|aborted/i.test(detail)) {
    return { status: 503, body: { ok: false, error: detail } };
  }
  return { status: 200, body: { ok: false, error: detail } };
}
