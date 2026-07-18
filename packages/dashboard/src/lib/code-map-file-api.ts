// Server-side helpers for /api/code-map/file — the session-scoped proxy that
// lets the code map's reading panel show real source text.
//
// Tenant scoping mirrors the model-connections routes: the installation is
// resolved ENTIRELY from the signed-in session (resolveSelectedInstallationIds);
// the browser's query params can pick among the session's own installations but
// can never smuggle a foreign id to the webhook hop. The GitHub fetch itself
// runs in the webhook service (App installation token, pr-fetcher pattern) —
// this module only proxies and maps the envelope to an HTTP status.

/** Wire shape of the webhook's /internal/context-map/file envelope. */
export type FileContentEnvelope =
  | { ok: true; path: string; text: string; truncated: boolean }
  | { ok: false; reason: 'invalid_path' | 'not_found' | 'binary' | 'too_large' | 'unavailable' };

/**
 * Envelope -> HTTP status. binary/too_large stay 200: they are honest,
 * renderable panel states, not transport errors. Unknown reasons map to 502
 * (conservative: treat as a broken upstream, never as success).
 */
export function statusForFileResult(result: FileContentEnvelope): number {
  if (result.ok) return 200;
  switch (result.reason) {
    case 'binary':
    case 'too_large':
      return 200;
    case 'invalid_path':
      return 400;
    case 'not_found':
      return 404;
    default:
      return 502;
  }
}

/** Proxy to the webhook's internal file endpoint. Never throws — an
 *  unreachable service is reported as the `unavailable` envelope. */
export async function fetchFileFromWebhook(
  externalInstallationId: number,
  path: string,
): Promise<FileContentEnvelope> {
  const base = process.env.WEBHOOK_SERVICE_URL;
  if (!base) return { ok: false, reason: 'unavailable' };
  try {
    const url = `${base}/internal/context-map/file?installationId=${externalInstallationId}&path=${encodeURIComponent(path)}`;
    const res = await fetch(url);
    const body = (await res.json().catch(() => null)) as FileContentEnvelope | null;
    if (!body || typeof body !== 'object') return { ok: false, reason: 'unavailable' };
    return body;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
