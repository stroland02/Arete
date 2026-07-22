// Signed-token guard for the service-to-service surface (/internal/*,
// /scan/trigger, /staging/send, /api/approvals/:id/execute, /fix/trigger).
// These endpoints trust their caller to have done tenant/session scoping
// (the dashboard resolves installations from the signed-in session before
// proxying), so the network hop itself must be authenticated: callers
// present `Authorization: Bearer <short-lived signed JWT>` minted by
// @arete/internal-token (mintInternalToken), verified here via
// verifyInternalToken.
//
// Fail-closed: if the keyset is not configured the surface answers 503
// rather than silently running open — a prod misconfig should be loud, not
// a hole.
//
// NOTE: /alerts/incoming is NOT behind this guard — Alertmanager presents a
// fixed static credential and cannot mint a JWT, so it uses the separate
// static guard in alertmanager-auth.ts (requireAlertmanagerToken).

import type { NextFunction, Request, Response } from 'express'
import { mintInternalToken, verifyInternalToken, InternalTokenNotConfigured } from '@arete/internal-token'

/**
 * OUTBOUND counterpart: the header this process presents when it calls a
 * SIBLING service's internal surface — today the agents service, whose POST
 * endpoints (/review, /scan, /fix, /chat, /approvals/apply,
 * /context-map/index) are behind the same signed-token guard with the same
 * fail-closed posture (packages/agents/src/arete_agents/internal_auth.py,
 * review finding B4). Mirrors packages/dashboard/src/lib/internal-auth.ts.
 *
 * Returns {} when unconfigured rather than throwing: the callee is the one
 * that fails closed, and a caller that invented its own failure mode here
 * would just be a second, divergent place to get the posture wrong.
 */
export async function internalAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = await mintInternalToken('arete-webhook')
    return { authorization: `Bearer ${token}` }
  } catch (err) {
    if (err instanceof InternalTokenNotConfigured) return {}
    throw err
  }
}

/** Express middleware requiring a valid signed internal token
 *  (verifyInternalToken). 503 when the keyset is unconfigured (misconfig),
 *  401 on any failed verification (missing/malformed/unknown kid/bad
 *  signature/expired/wrong audience) without leaking which. */
export function createInternalAuthMiddleware() {
  return async function requireInternalToken(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await verifyInternalToken(req.headers.authorization)
      if (!result.ok) {
        res.status(401).json({ error: 'unauthorized' })
        return
      }
      next()
    } catch (err) {
      if (err instanceof InternalTokenNotConfigured) {
        res.status(503).json({ error: 'internal_auth_not_configured' })
        return
      }
      throw err
    }
  }
}
