import { jwtVerify, decodeProtectedHeader, errors as joseErrors } from 'jose'
import { loadKeyset } from './keyset.js'
import { InternalTokenNotConfigured } from './errors.js'
import { INTERNAL_TOKEN_AUDIENCE } from './mint.js'

export type VerifyFailureReason =
  | 'no_header'
  | 'malformed'
  | 'unknown_kid'
  | 'bad_signature'
  | 'expired'
  | 'wrong_audience'

export type VerifyResult =
  | { ok: true; iss: string; kid: string }
  | { ok: false; reason: VerifyFailureReason }

/**
 * Verifies a `Bearer <jwt>` Authorization header minted by
 * `mintInternalToken`. Never throws on a bad token — every failure mode
 * (missing header, malformed value, revoked/unknown kid, tampered signature,
 * expiry, wrong audience) is a returned `{ ok: false, reason }`, so callers
 * can answer 401 without a try/catch.
 *
 * Throws `InternalTokenNotConfigured` only when the keyset itself is
 * unconfigured/unparseable — that is a 503 (misconfig), never a 401.
 *
 * `opts.now` is injectable seconds-since-epoch, forwarded to jose's
 * `currentDate` so tests can move the clock past expiry deterministically.
 */
export async function verifyInternalToken(
  authorizationHeader: string | undefined,
  opts?: { now?: number },
): Promise<VerifyResult> {
  const keyset = loadKeyset()
  if (!keyset) throw new InternalTokenNotConfigured()

  if (!authorizationHeader) return { ok: false, reason: 'no_header' }

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader)
  if (!match) return { ok: false, reason: 'malformed' }
  const token = match[1]

  let kid: string | undefined
  try {
    const header = decodeProtectedHeader(token)
    kid = typeof header.kid === 'string' ? header.kid : undefined
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!kid || !Object.prototype.hasOwnProperty.call(keyset.keys, kid)) {
    return { ok: false, reason: 'unknown_kid' }
  }

  const secret = new TextEncoder().encode(keyset.keys[kid])
  const now = opts?.now ?? Math.floor(Date.now() / 1000)

  try {
    const { payload } = await jwtVerify(token, secret, {
      audience: INTERNAL_TOKEN_AUDIENCE,
      clockTolerance: 5,
      currentDate: new Date(now * 1000),
    })
    return { ok: true, iss: String(payload.iss), kid }
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' }
    if (err instanceof joseErrors.JWTClaimValidationFailed && err.claim === 'aud') {
      return { ok: false, reason: 'wrong_audience' }
    }
    return { ok: false, reason: 'bad_signature' }
  }
}
