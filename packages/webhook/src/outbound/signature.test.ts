import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { signWebhook, verifyWebhookSignature } from './signature.js'

// The signing scheme is deliberately identical to Stripe's / SuperLog's:
//   header  = `t=<unix-seconds>,v1=<hex>`
//   v1      = HMAC-SHA256(secret, `<t>.<rawBody>`)
// Receivers verify against the RAW body and reject stale timestamps (replay).

const SECRET = 'whsec_test_0123456789abcdef'
const BODY = '{"event":"review.created","review":{"id":"r_1"}}'

describe('signWebhook', () => {
  test('produces a t=<ts>,v1=<hex> header over "<ts>.<body>"', () => {
    const header = signWebhook(SECRET, BODY, 1_700_000_000)

    const expectedV1 = createHmac('sha256', SECRET).update('1700000000.' + BODY).digest('hex')
    expect(header).toBe(`t=1700000000,v1=${expectedV1}`)
  })

  test('changing the body changes the signature', () => {
    const a = signWebhook(SECRET, BODY, 1_700_000_000)
    const b = signWebhook(SECRET, BODY + ' ', 1_700_000_000)
    expect(a).not.toBe(b)
  })
})

describe('verifyWebhookSignature', () => {
  test('accepts a signature it just produced', () => {
    const now = 1_700_000_000
    const header = signWebhook(SECRET, BODY, now)
    expect(verifyWebhookSignature(SECRET, header, BODY, { nowSec: now })).toBe(true)
  })

  test('rejects a tampered body', () => {
    const now = 1_700_000_000
    const header = signWebhook(SECRET, BODY, now)
    expect(verifyWebhookSignature(SECRET, header, BODY + 'x', { nowSec: now })).toBe(false)
  })

  test('rejects the wrong secret', () => {
    const now = 1_700_000_000
    const header = signWebhook(SECRET, BODY, now)
    expect(verifyWebhookSignature('whsec_other', header, BODY, { nowSec: now })).toBe(false)
  })

  test('rejects a timestamp outside the tolerance window (replay)', () => {
    const signedAt = 1_700_000_000
    const header = signWebhook(SECRET, BODY, signedAt)
    // 6 minutes later, default tolerance is 300s → reject
    expect(verifyWebhookSignature(SECRET, header, BODY, { nowSec: signedAt + 360 })).toBe(false)
  })

  test('accepts within the tolerance window', () => {
    const signedAt = 1_700_000_000
    const header = signWebhook(SECRET, BODY, signedAt)
    expect(verifyWebhookSignature(SECRET, header, BODY, { nowSec: signedAt + 120 })).toBe(true)
  })

  test('rejects a malformed header', () => {
    expect(verifyWebhookSignature(SECRET, 'garbage', BODY, { nowSec: 1_700_000_000 })).toBe(false)
    expect(verifyWebhookSignature(SECRET, 't=1700000000', BODY, { nowSec: 1_700_000_000 })).toBe(false)
    expect(verifyWebhookSignature(SECRET, '', BODY, { nowSec: 1_700_000_000 })).toBe(false)
  })
})
