// POST /internal/model-connections/test — the internal endpoint the dashboard's
// session-authenticated /api/model-connections/test route proxies to. It runs
// the SSRF-guarded provider probe (net-guard, via testModelConnection) so the
// dashboard never has to make a customer-supplied-baseUrl request itself.
//
// Stateless: it persists nothing and returns no tenant data — it only validates
// a candidate { provider, model, apiKey?, baseUrl? }. The runner is injected so
// the adapter is testable without a real outbound call.

import type { RequestHandler } from 'express'
import { testModelConnection, type TestConnectionCandidate, type TestResult } from './test-connection.js'

type Tester = (candidate: TestConnectionCandidate) => Promise<TestResult>

export function createModelConnectionTestHandler(run: Tester = testModelConnection): RequestHandler {
  return async (req, res) => {
    const body = (req.body ?? {}) as {
      provider?: unknown
      model?: unknown
      apiKey?: unknown
      baseUrl?: unknown
    }
    const { provider, model } = body
    if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) {
      res.status(400).json({ ok: false, detail: 'provider and model are required' })
      return
    }
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
    const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl ? body.baseUrl : null

    try {
      const result = await run({ provider, model, apiKey, baseUrl })
      if (result.ok) {
        res.status(200).json({ ok: true, model })
      } else {
        res.status(200).json({ ok: false, detail: result.detail })
      }
    } catch (err) {
      // testModelConnection never throws, but guard the adapter regardless.
      res.status(200).json({ ok: false, detail: err instanceof Error ? err.message : String(err) })
    }
  }
}
