// The Express adapter for POST /staging/send — the HTTP skin over runStagingSend.
// Internal endpoint: the dashboard's "Post PR" action calls it with two internal
// uuids. This layer owns ONLY the HTTP concern — body validation and mapping the
// flat outcome to a status code — so the orchestration stays transport-agnostic
// and fully unit-tested (send.test.ts). The runner is injected (defaulting to the
// real runStagingSend) so this adapter is itself testable without db/GitHub.

import type { RequestHandler } from 'express'
import { runStagingSend, type StagingSendDeps, type StagingSendResult } from './send.js'

type Runner = (
  deps: StagingSendDeps,
  input: { containerId: string; installationId: string },
) => Promise<StagingSendResult>

/** opened/already_open are success (200); not_approved is the gate refusing (409,
 *  a precondition — retrying without approving won't help); failed is an
 *  upstream/resolution error (502, a bad gateway to GitHub or the tenant store). */
function statusFor(result: StagingSendResult): number {
  switch (result.outcome) {
    case 'opened':
    case 'already_open':
      return 200
    case 'not_approved':
      return 409
    case 'not_found':
      // No such container for this tenant — a client addressing error, not an
      // upstream fault. 404, distinct from not_approved's 409 and failed's 502.
      return 404
    case 'failed':
      return 502
  }
}

export function createStagingSendHandler(
  deps: StagingSendDeps,
  run: Runner = runStagingSend,
): RequestHandler {
  return async (req, res) => {
    const body = (req.body ?? {}) as { containerId?: unknown; installationId?: unknown }
    const { containerId, installationId } = body
    if (typeof containerId !== 'string' || typeof installationId !== 'string' || !containerId || !installationId) {
      res.status(400).json({ error: 'bad_request', detail: 'containerId and installationId are required' })
      return
    }

    try {
      const result = await run(deps, { containerId, installationId })
      res.status(statusFor(result)).json(result)
    } catch (err) {
      // runStagingSend already converts expected errors to { outcome: 'failed' };
      // this only guards against a programming error in the seam itself.
      console.error('[staging] Unhandled error in /staging/send:', err)
      res.status(500).json({ outcome: 'failed', detail: 'internal_error' })
    }
  }
}
