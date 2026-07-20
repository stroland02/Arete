// Shared bearer token for server-to-server calls to the webhook's internal
// surface (/internal/*, /scan/trigger, /staging/send). The webhook enforces
// this token fail-closed; we simply attach it when configured. Server-side
// only — the token must never reach the browser.

/** Authorization header for internal webhook calls, or {} when unconfigured. */
export function internalAuthHeaders(): Record<string, string> {
  const token = process.env.INTERNAL_API_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}
