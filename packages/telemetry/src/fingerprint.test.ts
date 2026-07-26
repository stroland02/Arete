import { describe, it, expect } from 'vitest'
import { normalizeErrorMessage, fingerprintScoped, fingerprintError } from './fingerprint.js'

// The cross-lane agreement gate for contract §5 ("one fingerprint, one
// normalizer"). This literal is asserted in THREE places that must never
// disagree:
//   1. here, over the shared implementation;
//   2. packages/dashboard/src/lib/error-fingerprint.test.ts — the READ-time
//      path (lib/errors.ts) that groups rows already in ClickHouse;
//   3. record-exception.test.ts — the EMIT-time `superlog.issue_fingerprint`
//      stamped on the exception event the projections read.
// Changing the algorithm therefore breaks all three at once and forces the
// change to be deliberate, instead of silently splitting one error group in
// two depending on which surface (or which era of data) you look at.
// Deliberately re-declared (not exported/imported) in each of the three files:
// a shared constant would let all three drift together in one edit, which is
// the exact failure mode this gate exists to catch.
const GOLDEN_SERVICE = 'arete-worker'
const GOLDEN_MESSAGE =
  'checkout 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed at 2026-07-21T21:01:31Z after 3 tries'
const GOLDEN_FINGERPRINT = '59cd230950082264'

describe('normalizeErrorMessage', () => {
  it('replaces urls, emails, uuids, timestamps, ips, hex, quoted strings and numbers', () => {
    expect(normalizeErrorMessage('see https://example.com/a?b=1 now')).toBe('see <url> now')
    expect(normalizeErrorMessage('user ops+kuma@example.com failed')).toBe('user <email> failed')
    expect(normalizeErrorMessage('req 3f2504e0-4f89-11d3-9a0c-0305e82c3301 died')).toBe('req <uuid> died')
    expect(normalizeErrorMessage('at 2026-07-21T21:01:31Z boom')).toBe('at <ts> boom')
    expect(normalizeErrorMessage('dial 10.0.0.14:8123 refused')).toBe('dial <ip> refused')
    expect(normalizeErrorMessage('addr 0xDEADBEEF invalid')).toBe('addr <hex> invalid')
    expect(normalizeErrorMessage('missing key "privateKey" here')).toBe('missing key <str> here')
    expect(normalizeErrorMessage("missing key 'privateKey' here")).toBe('missing key <str> here')
    expect(normalizeErrorMessage('retry 47 of 100')).toBe('retry <n> of <n>')
  })

  it('collapses whitespace and lowercases', () => {
    expect(normalizeErrorMessage('  Connection   RESET\n by peer  ')).toBe('connection reset by peer')
  })

  it('returns empty string for empty and whitespace-only input', () => {
    expect(normalizeErrorMessage('')).toBe('')
    expect(normalizeErrorMessage('   \n\t  ')).toBe('')
  })

  it('applies the rules in an order URLs survive', () => {
    // URLs and emails are consumed before the narrower uuid/ip/number rules can
    // chew holes in them.
    const raw = 'Failed https://x.io/y for 550e8400-e29b-41d4-a716-446655440000 after 3 tries'
    expect(normalizeErrorMessage(raw)).toBe('failed <url> for <uuid> after <n> tries')
  })
})

describe('fingerprintError', () => {
  it('produces a 16-char lowercase hex digest', () => {
    expect(fingerprintError('arete-worker', 'boom')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic', () => {
    expect(fingerprintError('arete-worker', 'boom')).toBe(fingerprintError('arete-worker', 'boom'))
  })

  it('groups the same failure across differing uuids, numbers, urls and timestamps', () => {
    const a = fingerprintError(
      'arete-worker',
      'checkout 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed at 2026-07-21T21:01:31Z after 3 tries (https://github.com/a/b.git)'
    )
    const b = fingerprintError(
      'arete-worker',
      'checkout 550e8400-e29b-41d4-a716-446655440000 failed at 2026-07-20T02:14:09Z after 17 tries (https://github.com/c/d.git)'
    )
    expect(a).toBe(b)
  })

  it('separates two genuinely different messages in the same service', () => {
    expect(fingerprintError('arete-worker', 'connection reset by peer')).not.toBe(
      fingerprintError('arete-worker', 'authentication failed')
    )
  })

  it('separates the SAME message emitted by different services', () => {
    expect(fingerprintError('arete-worker', 'connection reset by peer')).not.toBe(
      fingerprintError('arete-agents', 'connection reset by peer')
    )
  })

  it('handles empty and whitespace-only messages without throwing, and treats them alike', () => {
    expect(fingerprintError('arete-worker', '')).toMatch(/^[0-9a-f]{16}$/)
    expect(fingerprintError('arete-worker', '   ')).toBe(fingerprintError('arete-worker', ''))
  })

  it('matches the frozen cross-surface golden value', () => {
    expect(fingerprintError(GOLDEN_SERVICE, GOLDEN_MESSAGE)).toBe(GOLDEN_FINGERPRINT)
  })
})

describe('fingerprintScoped (the shared primitive both domains use)', () => {
  it('is exactly what fingerprintError computes — one hash, not two similar ones', () => {
    // packages/webhook/src/fingerprint.ts's `fingerprintComment(body, category)`
    // is `fingerprintScoped(category, body)`; the dashboard's read path is
    // `fingerprintError(service, message)`. Same function, honest argument
    // names per domain.
    expect(fingerprintScoped('arete-worker', 'connection reset by peer')).toBe(
      fingerprintError('arete-worker', 'connection reset by peer')
    )
  })

  it('keeps the scope out of the normalized text', () => {
    // 'a::b' as a scope must not collide with scope 'a' and text starting 'b'.
    expect(fingerprintScoped('a', 'b')).not.toBe(fingerprintScoped('a::b', ''))
  })
})
