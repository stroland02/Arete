import { SignJWT, type JWTPayload } from 'jose'
import { loadKeyset } from './keyset.js'
import { InternalTokenNotConfigured } from './errors.js'

export const INTERNAL_TOKEN_DEFAULT_TTL_SECONDS = 120

/** Audience claim shared by every internal token — the wire-format contract
 *  with the Python-side verifier (Task 4). */
export const INTERNAL_TOKEN_AUDIENCE = 'arete-internal'

export type InternalTokenIssuer = 'arete-webhook' | 'arete-dashboard' | 'arete-agents'

/**
 * Mints a compact HS256 JWT identifying this process to another internal
 * Areté service. Claims: `{ iss, aud: 'arete-internal', iat, exp }`; header:
 * `{ alg: 'HS256', typ: 'JWT', kid }`.
 *
 * `opts.now` is injectable seconds-since-epoch so callers (and the vector
 * test) can fully control `iat`/`exp` — with a fixed `now`, the result is
 * byte-for-byte deterministic, which is what makes a cross-language test
 * vector possible.
 *
 * Throws `InternalTokenNotConfigured` if the keyset/active kid is missing.
 */
export async function mintInternalToken(
  iss: InternalTokenIssuer,
  opts?: { now?: number },
): Promise<string> {
  const keyset = loadKeyset()
  if (!keyset) throw new InternalTokenNotConfigured()

  const now = opts?.now ?? Math.floor(Date.now() / 1000)
  const ttl = resolveTtlSeconds()
  const exp = now + ttl

  const kid = keyset.activeKid
  const secret = new TextEncoder().encode(keyset.keys[kid])

  const payload: JWTPayload = {
    iss,
    aud: INTERNAL_TOKEN_AUDIENCE,
    iat: now,
    exp,
  }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid })
    .sign(secret)
}

function resolveTtlSeconds(): number {
  const raw = process.env.INTERNAL_TOKEN_TTL_SECONDS
  if (!raw) return INTERNAL_TOKEN_DEFAULT_TTL_SECONDS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : INTERNAL_TOKEN_DEFAULT_TTL_SECONDS
}
