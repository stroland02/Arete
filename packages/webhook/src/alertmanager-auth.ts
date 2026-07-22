// Static-token guard for the Alertmanager ingest endpoint (/alerts/incoming)
// ONLY. Every other internal-to-internal caller in this service mints and
// verifies a short-lived signed JWT (see internal-auth.ts /
// @arete/internal-token) — Alertmanager cannot do that: it presents a fixed
// string configured via its `credentials_file` http_config and has no way to
// mint a token per request. This guard is therefore deliberately a SEPARATE,
// static credential (ALERTMANAGER_INGEST_TOKEN), not the internal-token
// keyset, so the two auth surfaces cannot be confused with one another.
//
// Fail-closed: if the token is not configured the route answers 503 rather
// than silently running open.

import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

/** Constant-time check of an Authorization header against the expected
 *  static bearer token. Same shape as the former internal-auth.ts
 *  `tokenMatches` (Global Constraint 5) — moved here because this is now
 *  its only caller. */
export function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header) return false
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) return false
  const presented = Buffer.from(match[1])
  const expected = Buffer.from(token)
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

/** Express middleware requiring the static Alertmanager ingest bearer token
 *  (ALERTMANAGER_INGEST_TOKEN), read per-request. Signed internal JWTs
 *  (mintInternalToken / createInternalAuthMiddleware) are NOT accepted
 *  here — Alertmanager cannot mint one, so accepting them would just widen
 *  this route's trusted-caller set beyond Alertmanager itself. */
export function requireAlertmanagerToken(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.ALERTMANAGER_INGEST_TOKEN
  if (!token) {
    res.status(503).json({ error: 'internal_auth_not_configured' })
    return
  }
  if (!tokenMatches(req.headers.authorization, token)) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  next()
}
