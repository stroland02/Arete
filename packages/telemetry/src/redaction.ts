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

/** For `url.query` (semconv: the query string itself, with NO leading `?` and
 *  no scheme/host/path) — the entire attribute value IS the query, so
 *  `stripUrlQuery` (which only cuts from a literal `?`) would be a no-op and
 *  leak it whole. Redact the value unconditionally instead. */
export function clearUrlQuery(_value: string): string {
  return ''
}

/**
 * Recursively scrub every string value in a plain-object/array tree with
 * {@link scrubText}. Used by the pino `formatters.log` hook (logger.ts) so
 * secret-shaped substrings inside free-text fields (e.g. `err.message`) are
 * masked — `redact.paths` only zeroes out specific KEY paths, it never
 * inspects the text of a value.
 *
 * Error instances are special-cased: pino's own `err`-key serializer runs
 * AFTER `formatters.log`, on whatever object we return, and only produces
 * its usual `{type, message, stack}` shape when the value is still a real
 * Error — so this rebuilds one (same constructor/name, scrubbed
 * message/stack, other own enumerable props scrubbed too) instead of
 * flattening it to a plain object.
 */
export function scrubLogValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return scrubText(value)
  if (value instanceof Error) {
    if (seen.has(value)) return value
    seen.add(value)
    const Ctor = (value.constructor as new (message?: string) => Error) ?? Error
    const scrubbed = new Ctor(scrubText(value.message))
    scrubbed.name = value.name
    if (value.stack) scrubbed.stack = scrubText(value.stack)
    for (const key of Object.keys(value)) {
      ;(scrubbed as unknown as Record<string, unknown>)[key] = scrubLogValue(
        (value as unknown as Record<string, unknown>)[key],
        seen
      )
    }
    return scrubbed
  }
  if (Array.isArray(value)) return value.map((el) => scrubLogValue(el, seen))
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value
    seen.add(value)
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubLogValue(val, seen)
    }
    return out
  }
  return value
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
