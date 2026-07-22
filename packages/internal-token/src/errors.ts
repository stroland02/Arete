/** Thrown when the internal-token keyset itself is missing or unparseable —
 *  distinct from any bad-token result, so callers can answer 503 (misconfig)
 *  instead of 401 (unauthorized). Never thrown for a bad/expired/tampered
 *  token; those are returned as `{ ok: false, reason }`. */
export class InternalTokenNotConfigured extends Error {
  constructor(message = 'internal token keyset is not configured') {
    super(message)
    this.name = 'InternalTokenNotConfigured'
  }
}
