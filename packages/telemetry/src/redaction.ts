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
export function scrubLogValue(
  value: unknown,
  // Original -> its clone, NOT a plain seen-set. Returning the original on a
  // revisit would re-expose it unscrubbed one level down in any cyclic payload
  // (`a.self = a` leaked its own secret-bearing fields). The clone is recorded
  // before recursing, so a cycle resolves to the scrubbed copy.
  seen: WeakMap<object, unknown> = new WeakMap()
): unknown {
  if (typeof value === 'string') return scrubText(value)
  if (value instanceof Error) {
    if (seen.has(value)) return seen.get(value)
    // Clone by prototype, never `new value.constructor(message)`: subclass
    // constructors take their own argument shapes, and re-running one with a
    // lone string throws or corrupts. @octokit/request-error does
    // `if ("response" in options)` on arg 3 (TypeError on undefined);
    // `new AggregateError(string)` reads the string as the errors iterable and
    // splays it into characters. Either turns a logged error into a thrown one
    // — violating the §3 "telemetry never takes the app down" invariant on the
    // exact path where the log matters most.
    const scrubbed = Object.create(Object.getPrototypeOf(value)) as Error
    seen.set(value, scrubbed) // before recursing, so cycles land on the clone
    Object.assign(scrubbed, value)
    scrubbed.name = value.name
    scrubbed.message = scrubText(value.message)
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
    if (seen.has(value)) return seen.get(value)
    const out: Record<string, unknown> = {}
    seen.set(value, out) // before recursing, so cycles land on the clone
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubLogValue(val, seen)
    }
    return out
  }
  return value
}

/** `authorization` -> `authorization`, `X-Api-Key`/`api_key`/`apiKey` -> `apikey`.
 *  Case- and separator-insensitive so one blocklist entry covers every spelling
 *  a header, label, or annotation key actually arrives in. */
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '')
}

/** Areté-specific key names, beyond the frozen spec §5 `REDACT_KEYS`, that
 *  {@link PINO_REDACT_PATHS} additionally redacts (see its own doc comment
 *  for why each one is there). Hoisted to a shared constant so
 *  `REDACT_KEY_SET` (the sink-side key set) and `PINO_REDACT_PATHS` compose
 *  the SAME posture instead of drifting — `scrubSinkValue` previously
 *  reached only `REDACT_KEYS`, so `installationToken` (a live GitHub App
 *  installation token) passed through a persistence-sink write unredacted
 *  (finding N3). `apiKey` is omitted: `normaliseKey` already collapses it to
 *  `apikey`, which `REDACT_KEYS` covers. */
const AGENT_EXTRA_REDACT_KEYS = ['privateKey', 'installationToken', 'webhookSecret'] as const

const REDACT_KEY_SET: ReadonlySet<string> = new Set(
  [...REDACT_KEYS, ...AGENT_EXTRA_REDACT_KEYS].map(normaliseKey)
)

/** Scheme-qualified URL, e.g. `https://…`, `postgres://…`. Matches a URL
 *  substring anywhere in a larger string (not anchored), so prose with an
 *  embedded URL ("see https://x.io/a?password=… for details") and markdown
 *  links ("[link](https://x.io/a?password=…)") are found too — that shape,
 *  not a bare whole-string URL, is the dominant one for alert summaries and
 *  memory bodies (finding N1: the prior `^…\S+$`-anchored version only ever
 *  matched when the ENTIRE trimmed value was a URL). The character class
 *  excludes common textual/markdown delimiters (whitespace, quotes, angle
 *  brackets, parens, brackets, backtick) so it stops at the URL's actual
 *  boundary instead of swallowing trailing prose or markdown syntax. */
const EMBEDDED_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'()[\]`]+/gi

/**
 * String scrub for PERSISTENCE sinks (incident rows, memory rows — anything
 * that outlives a log line). Strictly stronger than {@link scrubText}: it also
 * drops the query string of every URL-shaped SUBSTRING (whole-string URLs
 * included — a bare URL is a one-URL-long substring of itself), because the
 * value patterns only know a fixed list of key-ish query params (`key|
 * api_key|apikey|token|access_token|client_secret`) and a URL can carry a
 * credential under any name at all (`?password=…` was not matched — Phase 2
 * review finding I5, and finding N1 for the embedded-in-prose case).
 */
export function scrubSinkText(text: string): string {
  return scrubText(text.replace(EMBEDDED_URL, (url) => stripUrlQuery(url)))
}

/**
 * Deep scrub for PERSISTENCE sinks. {@link scrubLogValue} applies value
 * patterns only — in the logging sink the key blocklist is applied separately,
 * by pino's `redact.paths` ({@link PINO_REDACT_PATHS}). A non-pino sink that
 * used `scrubLogValue` alone would therefore get only half of the canonical
 * redaction: `{ password: 'hunter2' }` has no secret *shape* and survives.
 *
 * This applies BOTH halves plus {@link scrubSinkText}, so any sink can reach
 * the full spec §5 posture through one canonical call. The key half composes
 * `REDACT_KEYS` WITH {@link AGENT_EXTRA_REDACT_KEYS} — matching
 * {@link PINO_REDACT_PATHS} exactly — rather than `REDACT_KEYS` alone, so
 * `installationToken`/`privateKey`/`webhookSecret` cannot pass through a
 * persistence sink unredacted the way they never could through pino
 * (finding N3; previously the docblock claimed this parity without the code
 * actually composing it).
 *
 * Input is expected to be JSON-ish (the alert-payload case); the output is
 * always JSON-serializable: `Date` becomes its ISO string and `Error` becomes
 * a plain `{ name, message, stack, …ownProps }` object (both scrubbed) rather
 * than falling into the generic object branch, where `Object.entries` on
 * either yields nothing and silently reduces them to `{}` (finding N4,
 * following {@link scrubLogValue}'s existing Error precedent in this same
 * file — though that helper returns a real `Error` instance, which this one
 * deliberately does not, to keep the "always JSON-serializable" contract:
 * `JSON.stringify(new Error(...))` itself flattens to `{}`).
 */
export function scrubSinkValue(
  value: unknown,
  seen: WeakMap<object, unknown> = new WeakMap()
): unknown {
  if (typeof value === 'string') return scrubSinkText(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    if (seen.has(value)) return seen.get(value)
    const out: Record<string, unknown> = { name: value.name, message: scrubSinkText(value.message) }
    seen.set(value, out) // before recursing, so cycles land on the clone
    if (value.stack) out.stack = scrubSinkText(value.stack)
    for (const key of Object.keys(value)) {
      out[key] = scrubSinkValue((value as unknown as Record<string, unknown>)[key], seen)
    }
    return out
  }
  if (Array.isArray(value)) return value.map((el) => scrubSinkValue(el, seen))
  if (value && typeof value === 'object') {
    if (seen.has(value)) return seen.get(value)
    const out: Record<string, unknown> = {}
    seen.set(value, out) // before recursing, so cycles land on the clone
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEY_SET.has(normaliseKey(key)) ? REDACTED : scrubSinkValue(val, seen)
    }
    return out
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  // undefined / function / symbol / bigint — not JSON leaves; drop to null
  // rather than emitting something a Json column cannot hold.
  return null
}

/** pino redact.paths — key blocklist at top level, one wildcard level deep,
 *  and under req/res headers. `installationToken` is Areté-specific: PRContext
 *  carries a live GitHub App installation token (worker.ts buildCloneContext).
 *  `privateKey` and `webhookSecret` are the other two Areté-specific names —
 *  see {@link AGENT_EXTRA_REDACT_KEYS}, which this composes rather than
 *  re-listing so the pino path and the sink path (`REDACT_KEY_SET`) cannot
 *  drift apart again (finding N3). */
export const PINO_REDACT_PATHS: string[] = [
  ...REDACT_KEYS.flatMap((k) => {
    const seg = /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `["${k}"]`
    const top = seg.startsWith('.') ? seg.slice(1) : seg
    return [top, `*${seg}`, `req.headers${seg}`, `res.headers${seg}`, `headers${seg}`]
  }),
  'apiKey', '*.apiKey',
  ...AGENT_EXTRA_REDACT_KEYS.flatMap((k) => [k, `*.${k}`]),
]
