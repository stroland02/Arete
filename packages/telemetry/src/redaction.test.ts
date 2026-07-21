import { describe, it, expect } from 'vitest'
import { scrubText, stripUrlQuery, REDACT_KEYS, PINO_REDACT_PATHS } from './redaction.js'

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
