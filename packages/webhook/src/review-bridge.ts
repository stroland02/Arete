import type { PRContext, ReviewResult } from './types.js'
import { getServiceConfig } from './config.js'
import {
  resolveModelConnectionForReview,
  defaultResolveModelDeps,
  type LlmConfig,
} from './resolve-model-connection.js'
import { logger } from './logger.js'
import { internalAuthHeaders } from './internal-auth.js'

const log = logger.child({ component: 'review-bridge' })

export interface ReviewBridgeDeps {
  /** Resolve the tenant's `llm` block from the numeric installation id, or
   *  undefined when the tenant has no connection. Injected in tests; defaults to
   *  the real Prisma-backed resolver. */
  resolveModel?: (externalInstallationId: number) => Promise<LlmConfig | undefined>
}

export async function runReviewPipeline(
  prContext: PRContext,
  deps: ReviewBridgeDeps = {},
): Promise<ReviewResult> {
  // Single /review choke point: resolve the tenant's Bring-Your-Own model
  // connection into the `llm` block the agents /review consumes, so every review
  // path forwards it without each caller remembering to. Guarded on
  // installationId (unit paths that omit it are unaffected). When the tenant has
  // no connection we leave `llm` unset and the agents service uses its own
  // default (Ollama safety fallback) — never a raw env key. Resolution must never
  // block a review: on error we log and proceed without `llm`.
  if (prContext.installationId != null && prContext.llm == null) {
    const resolve =
      deps.resolveModel ??
      ((id: number) => resolveModelConnectionForReview(id, defaultResolveModelDeps()))
    try {
      const llm = await resolve(prContext.installationId)
      if (llm) prContext.llm = llm
    } catch (err) {
      log.error({ err }, 'model-connection resolve failed; proceeding on service default')
    }
  }

  // The review is an unbounded LLM workload — six specialists over the PR diff.
  // 120s was fine for a fast cloud model but aborts every review against a slow
  // local one (Ollama), which is why no PR review has completed here. Made
  // configurable with a generous default, matching the scan path's
  // SCAN_REQUEST_TIMEOUT_MS convention: this bounds a HANG, not slowness.
  const REVIEW_TIMEOUT_MS = Number(process.env.REVIEW_REQUEST_TIMEOUT_MS ?? 15 * 60 * 1000)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, REVIEW_TIMEOUT_MS)

  try {
    const baseUrl = getServiceConfig().pythonServiceUrl
    // prContext already carries the resolved `llm` block (attached above) —
    // the agents /review parses exactly that name. (A stale merge remnant here
    // used to re-map a long-gone `modelConnection` field; removed.)
    const res = await fetch(`${baseUrl}/review`, {
      method: 'POST',
      body: JSON.stringify(prContext),
      headers: { 'Content-Type': 'application/json', ...(await internalAuthHeaders()) },
      signal: controller.signal
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Python pipeline exited with status ${res.status}: ${errorText}`)
    }

    return await res.json() as ReviewResult
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Python pipeline timed out after 120s')
    }
    throw new Error(`Failed to parse pipeline output: ${err}`)
  } finally {
    clearTimeout(timer)
  }
}
