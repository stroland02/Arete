import { describe, it, expect } from 'vitest'
import {
  scrubText,
  stripUrlQuery,
  scrubSinkText,
  scrubSinkValue,
  REDACT_KEYS,
  PINO_REDACT_PATHS,
  REDACTED,
} from './redaction.js'

// Fake canary secrets — never real values.
const CANARIES = [
  'Bearer ghs_FakeCanary1234567890abcdefghij',
  'sk-ant-canary00000000000000000000',
  'ghp_FakeCanary1234567890abcdefghij',
  'glpat-FakeCanary123456789',
  'whsec_FakeCanary1234567890',
]

describe('scrubText', () => {
  it.each(CANARIES)('redacts %s', (canary) => {
    const out = scrubText(`request failed: ${canary} while calling api`)
    expect(out).not.toContain(canary.split(' ').pop())
    expect(out).toContain('[REDACTED]')
  })

  it('redacts key-shaped query params but keeps the param name', () => {
    const out = scrubText('GET https://api.example.com/v1/models?key=AIzaFakeCanary123&x=1 failed')
    expect(out).not.toContain('AIzaFakeCanary123')
    expect(out).toContain('key=[REDACTED]')
  })

  it('leaves clean text untouched', () => {
    const text = 'reviewed acme/api#42 with 3 comments'
    expect(scrubText(text)).toBe(text)
  })
})

describe('stripUrlQuery', () => {
  it('strips the entire query string', () => {
    expect(stripUrlQuery('https://api.example.com/v1/generate?key=secret123&b=2'))
      .toBe('https://api.example.com/v1/generate')
  })
  it('returns non-URL input unchanged when it has no query separator', () => {
    expect(stripUrlQuery('not a url')).toBe('not a url')
  })
})

describe('scrubSinkText strips query strings from URLs embedded in prose (finding N1)', () => {
  // Adversarial re-review probe: `stripUrlQuery` inside `scrubSinkText` was
  // gated by `URL_LIKE`, which is anchored `^…\S+$` — so the query string
  // was only stripped when the ENTIRE trimmed value was a bare URL. Prose
  // with an embedded URL (the dominant shape for alert summaries and memory
  // bodies alike) sailed through unchanged.
  it('still strips the query string from a bare whole-string URL', () => {
    expect(scrubSinkText('https://x.io/a?password=topsecret')).toBe('https://x.io/a')
  })

  it('strips the query string from a URL embedded in surrounding prose', () => {
    const out = scrubSinkText('see https://x.io/a?password=topsecret for details')
    expect(out).not.toContain('topsecret')
    expect(out).toBe('see https://x.io/a for details')
  })

  it('strips the query string from a URL embedded in a markdown link', () => {
    const out = scrubSinkText('[link](https://x.io/a?password=topsecret)')
    expect(out).not.toContain('topsecret')
    expect(out).toBe('[link](https://x.io/a)')
  })

  it('strips multiple embedded URLs in the same string', () => {
    const out = scrubSinkText(
      'primary https://x.io/a?token=one backup https://y.io/b?token=two'
    )
    expect(out).not.toContain('token=one')
    expect(out).not.toContain('token=two')
    expect(out).toBe('primary https://x.io/a backup https://y.io/b')
  })

  it('leaves prose with no URL untouched', () => {
    const text = 'no links here, just a password: hunter2 mention'
    expect(scrubSinkText(text)).toBe(text)
  })
})

describe('scrubSinkValue reaches the same key posture as the pino path (finding N3)', () => {
  // `PINO_REDACT_PATHS` additionally redacts `privateKey`, `installationToken`,
  // and `webhookSecret` (Areté-specific — `installationToken` carries a live
  // GitHub App installation token, per its doc comment). `scrubSinkValue`'s
  // own docblock claims "the full spec §5 posture" but only composed
  // REDACT_KEYS, so these three survived a persistence-sink write untouched.
  it('redacts installationToken by KEY name, independent of the value having a recognizable secret shape', () => {
    // Deliberately NOT gh?_-shaped or otherwise pattern-matched — this must
    // be caught by the key blocklist alone, the same way `installationToken`
    // is caught in PINO_REDACT_PATHS, or the test would pass for the wrong
    // reason (a real installation token IS gh?_-shaped and would be caught
    // by SECRET_VALUE_PATTERNS regardless of this finding).
    const out = scrubSinkValue({ installationToken: 'opaque-live-value-000111222' }) as Record<
      string,
      unknown
    >
    expect(out.installationToken).toBe(REDACTED)
  })

  it('redacts privateKey and webhookSecret the same way', () => {
    const out = scrubSinkValue({ privateKey: 'pk-material', webhookSecret: 'whs-material' }) as Record<
      string,
      unknown
    >
    expect(out.privateKey).toBe(REDACTED)
    expect(out.webhookSecret).toBe(REDACTED)
  })
})

describe('scrubSinkValue special-cases Date and Error (finding N4)', () => {
  // `Object.entries` on a Date or an Error yields nothing (their fields are
  // non-enumerable own properties), so the generic object branch reduced
  // both to `{}`. `scrubLogValue` in this same file already special-cases
  // Error; this is the sink-side precedent it should follow.
  it('does not flatten a Date to {}', () => {
    const d = new Date('2026-01-01T00:00:00.000Z')
    const out = scrubSinkValue(d)
    expect(out).not.toEqual({})
    expect(out).toBe(d.toISOString())
  })

  it('does not flatten an Error to {}, and scrubs its message', () => {
    const err = new Error('token leak: Bearer ghs_FakeCanary1234567890abcdefghij here')
    const out = scrubSinkValue(err) as Record<string, unknown>
    expect(out).not.toEqual({})
    expect(String(out.message)).toContain(REDACTED)
    expect(String(out.message)).not.toContain('FakeCanary1234567890abcdefghij')
  })
})

describe('blocklist completeness (spec §5 — frozen)', () => {
  it.each(['authorization', 'x-api-key', 'api_key', 'token', 'secret', 'password', 'cookie', 'set-cookie'])(
    'REDACT_KEYS contains %s', (key) => {
      expect(REDACT_KEYS).toContain(key)
    })
  it('pino paths cover nested headers for every key', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers.authorization')
    expect(PINO_REDACT_PATHS).toContain('req.headers["x-api-key"]')
    expect(PINO_REDACT_PATHS).toContain('*.installationToken')
  })
})
