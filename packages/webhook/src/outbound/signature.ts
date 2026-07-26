import { createHmac, timingSafeEqual } from 'node:crypto'

// Outbound-webhook signing. Deliberately the same construction as Stripe's and
// SuperLog's signatures, and the same primitive (HMAC-SHA256) already used for
// inbound Stripe verification and OAuth-state signing (see oauth/oauth-state.ts):
//
//   header = `t=<unix-seconds>,v1=<hex>`
//   v1     = HMAC-SHA256(endpoint.secret, `<t>.<rawBody>`)
//
// The signed payload binds the timestamp to the exact raw body, so a receiver
// verifies against the bytes it received and rejects a stale `t` to bound replay.

/** Default replay window: reject a signature whose timestamp is more than this
 *  many seconds from the receiver's clock. Matches Stripe's 5-minute default. */
export const DEFAULT_TOLERANCE_SEC = 300

function computeV1(secret: string, timestampSec: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex')
}

/** Produce the `Arete-Signature` header value for a delivery. */
export function signWebhook(secret: string, rawBody: string, timestampSec: number): string {
  return `t=${timestampSec},v1=${computeV1(secret, timestampSec, rawBody)}`
}

function parseHeader(header: string): { t: number; v1: string } | null {
  const parts = header.split(',')
  let t: number | null = null
  let v1: string | null = null
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (key === 't') t = Number(value)
    else if (key === 'v1') v1 = value
  }
  if (t === null || !Number.isFinite(t) || v1 === null || v1 === '') return null
  return { t, v1 }
}

export interface VerifyOptions {
  /** Current time in unix seconds; injectable for deterministic tests. */
  nowSec?: number
  /** Replay window in seconds. Defaults to DEFAULT_TOLERANCE_SEC. */
  toleranceSec?: number
}

/** Constant-time verification of an `Arete-Signature` header against the raw
 *  body. Returns false (never throws) for any malformed header, secret
 *  mismatch, or out-of-tolerance timestamp. */
export function verifyWebhookSignature(
  secret: string,
  header: string,
  rawBody: string,
  options: VerifyOptions = {},
): boolean {
  const parsed = parseHeader(header)
  if (!parsed) return false

  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000)
  const tolerance = options.toleranceSec ?? DEFAULT_TOLERANCE_SEC
  if (Math.abs(nowSec - parsed.t) > tolerance) return false

  const expected = computeV1(secret, parsed.t, rawBody)
  const a = Buffer.from(parsed.v1, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}
