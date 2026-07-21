/**
 * Redaction core — spec §5 blocklist, FROZEN. Shared by the pino logger
 * factory (log-creation time), the span scrubber (export time), and — by
 * convention only — Agent B's structlog censor and the collector redaction
 * processor. Changing keys/patterns requires a spec amendment.
 */

export const REDACT_KEYS = [
  'authorization',
  'x-api-key',
  'api_key',
  'apikey',
  'token',
  'secret',
  'password',
  'cookie',
  'set-cookie',
] as const

/**
 * Value-shape patterns (spec §5): bearer tokens, provider key shapes
 * (sk-*, gh?_*, glpat-*, whsec_*), and key-ish URL query params.
 * The query-param pattern keeps the `name=` prefix (capture group 1) so
 * scrubbed URLs stay debuggable.
 */
export const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bglpat-[A-Za-z0-9_-]{10,}/g,
  /\bwhsec_[A-Za-z0-9]{10,}/g,
  /([?&](?:key|api_key|apikey|token|access_token|client_secret)=)[^&\s'"]+/gi,
]

export const REDACTED = '[REDACTED]'

/** Replace every secret-shaped substring with [REDACTED]. Idempotent. */
export function scrubText(text: string): string {
  let out = text
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) =>
      typeof prefix === 'string' ? `${prefix}${REDACTED}` : REDACTED
    )
  }
  return out
}

/** Drop the entire query string from a URL-ish string (spec §5: query strings
 *  never reach span attributes — credentials-in-URLs are audited, not assumed). */
export function stripUrlQuery(url: string): string {
  const i = url.indexOf('?')
  return i === -1 ? url : url.slice(0, i)
}

/** pino redact.paths — key blocklist at top level, one wildcard level deep,
 *  and under req/res headers. `installationToken` is Areté-specific: PRContext
 *  carries a live GitHub App installation token (worker.ts buildCloneContext). */
export const PINO_REDACT_PATHS: string[] = [
  ...REDACT_KEYS.flatMap((k) => {
    const seg = /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `["${k}"]`
    const top = seg.startsWith('.') ? seg.slice(1) : seg
    return [top, `*${seg}`, `req.headers${seg}`, `res.headers${seg}`, `headers${seg}`]
  }),
  'apiKey', '*.apiKey',
  'privateKey', '*.privateKey',
  'installationToken', '*.installationToken',
  'webhookSecret', '*.webhookSecret',
]
