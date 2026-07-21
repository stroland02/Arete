// Shared-token guard for the service-to-service surface (/internal/*,
// /scan/trigger, /staging/send). These endpoints trust their caller to have
// done tenant/session scoping (the dashboard resolves installations from the
// signed-in session before proxying), so the network hop itself must be
// authenticated: callers present `Authorization: Bearer <INTERNAL_API_TOKEN>`.
//
// Fail-closed: if the token is not configured the surface answers 503 rather
// than silently running open — a prod misconfig should be loud, not a hole.

import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

/**
 * OUTBOUND counterpart: the header this process presents when it calls a
 * SIBLING service's internal surface — today the agents service, whose POST
 * endpoints (/review, /scan, /fix, /chat, /approvals/apply,
 * /context-map/index) are behind the same shared bearer with the same
 * fail-closed posture (packages/agents/src/arete_agents/internal_auth.py,
 * review finding B4). Mirrors packages/dashboard/src/lib/internal-auth.ts.
 *
 * Returns {} when unconfigured rather than throwing: the callee is the one
 * that fails closed, and a caller that invented its own failure mode here
 * would just be a second, divergent place to get the posture wrong.
 */
export function internalAuthHeaders(): Record<string, string> {
  const token = process.env.INTERNAL_API_TOKEN
  return token ? { authorization: `Bearer ${token}` } : {}
}

/** Constant-time check of an Authorization header against the shared token. */
export function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header) return false
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) return false
  const presented = Buffer.from(match[1])
  const expected = Buffer.from(token)
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

/** Express middleware requiring the shared internal bearer token. The token is
 *  read per-request (injectable for tests; defaults to INTERNAL_API_TOKEN). */
export function createInternalAuthMiddleware(
  getToken: () => string | undefined = () => process.env.INTERNAL_API_TOKEN,
) {
  return function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
    const token = getToken()
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
}
