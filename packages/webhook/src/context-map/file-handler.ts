// GET /internal/context-map/file — the internal endpoint the dashboard's
// session-authenticated /api/code-map/file route proxies to. The dashboard
// resolves WHICH installation from the session (never the browser); this
// adapter only parses/validates the query and shapes the envelope. The runner
// is injected so the adapter is testable without GitHub or a DB.

import type { RequestHandler } from 'express'
import { fetchRepoFileContent, type FileContentResult } from './file-content.js'

type Runner = (args: { externalInstallationId: number; path: string }) => Promise<FileContentResult>

export function createContextMapFileHandler(run: Runner = fetchRepoFileContent): RequestHandler {
  return async (req, res) => {
    const rawId = req.query.installationId
    const rawPath = req.query.path
    const externalInstallationId = typeof rawId === 'string' ? Number(rawId) : NaN
    if (!Number.isInteger(externalInstallationId) || externalInstallationId <= 0) {
      res.status(400).json({ ok: false, reason: 'invalid_installation' })
      return
    }
    if (typeof rawPath !== 'string' || !rawPath) {
      res.status(400).json({ ok: false, reason: 'invalid_path' })
      return
    }

    try {
      res.status(200).json(await run({ externalInstallationId, path: rawPath }))
    } catch (err) {
      // fetchRepoFileContent never throws, but guard the adapter regardless.
      console.error('[context-map] file handler failed', err)
      res.status(200).json({ ok: false, reason: 'unavailable' })
    }
  }
}
