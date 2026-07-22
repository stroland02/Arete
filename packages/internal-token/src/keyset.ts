// Env parsing for the internal-token signing keyset. Read per-call (not
// captured at import) so callers — and tests — can mutate process.env and
// see the new keyset take effect on the next mint/verify, mirroring how
// internal-auth.ts reads INTERNAL_API_TOKEN per request.

export interface InternalTokenKeyset {
  /** kid -> secret material (raw string, HMAC-256 key). */
  keys: Record<string, string>
  /** The kid new tokens are minted with. Must be a member of `keys`. */
  activeKid: string
}

/**
 * Loads the signing keyset from `INTERNAL_TOKEN_SIGNING_KEYS` (a JSON object
 * mapping kid -> secret) and `INTERNAL_TOKEN_ACTIVE_KID`.
 *
 * Returns `null` — never throws — when the env is missing, unparseable, an
 * empty object, or when the active kid does not name a key present in the
 * keyset. Callers (mint/verify) turn `null` into `InternalTokenNotConfigured`.
 */
export function loadKeyset(): InternalTokenKeyset | null {
  const raw = process.env.INTERNAL_TOKEN_SIGNING_KEYS
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const keys = parsed as Record<string, string>
  if (Object.keys(keys).length === 0) return null

  const activeKid = process.env.INTERNAL_TOKEN_ACTIVE_KID
  if (!activeKid || !Object.prototype.hasOwnProperty.call(keys, activeKid)) return null

  return { keys, activeKid }
}
