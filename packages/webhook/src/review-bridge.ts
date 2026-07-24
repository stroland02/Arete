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

  // prContext already carries the resolved `llm` block (attached above) — the
  // agents /review parses exactly that name.
  const baseUrl = getServiceConfig().pythonServiceUrl
  return executeReviewRequest(baseUrl, prContext, () => internalAuthHeaders())
}

/** How long to wait overall for a review, and how often to poll for it. */
const REVIEW_REQUEST_TIMEOUT_MS = Number(process.env.REVIEW_REQUEST_TIMEOUT_MS ?? 45 * 60 * 1000)
const REVIEW_POLL_INTERVAL_MS = Number(process.env.REVIEW_POLL_INTERVAL_MS ?? 5_000)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface ReviewHttpOptions {
  fetchFn?: typeof fetch
  pollIntervalMs?: number
  deadlineMs?: number
}

/**
 * Run a review against the agents service without a connection outliving it.
 *
 * The review path hits the identical ~300s connection ceiling the scan did —
 * confirmed live: a review of real PR #1 reached agents /review and died with
 * `fetch failed` at ~307s, the same unidentified sever. So this is the exact
 * twin of the scan's `executeScanRequest` (63479fd): submit with `mode:"async"`,
 * get a runId, poll `GET /review/runs/{id}`. No connection stays open for the
 * review's duration, so whatever severs long connections stops mattering.
 *
 * Reversible: an agents service that predates `mode` ignores it and returns the
 * ReviewResult inline, which is passed through unchanged. Headers are minted per
 * request — a review can outlive one short-lived internal token.
 *
 * (Deliberately self-contained rather than sharing executeScanRequest: that path
 * is verified live and load-bearing, and this lands without touching it. Once
 * this is also proven live, the two poll loops should be collapsed into one
 * helper — noted in the ledger.)
 */
export async function executeReviewRequest(
  baseUrl: string,
  prContext: PRContext,
  headersFn: () => Promise<Record<string, string>>,
  opts: ReviewHttpOptions = {},
): Promise<ReviewResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const deadlineMs = opts.deadlineMs ?? REVIEW_REQUEST_TIMEOUT_MS
  const pollIntervalMs = opts.pollIntervalMs ?? REVIEW_POLL_INTERVAL_MS
  const startedAt = Date.now()

  const submit = await fetchFn(`${baseUrl}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await headersFn()) },
    body: JSON.stringify({ ...prContext, mode: 'async' }),
    ...(deadlineMs > 0 ? { signal: AbortSignal.timeout(deadlineMs) } : {}),
  })
  if (!submit.ok) {
    const text = await submit.text().catch(() => '')
    throw new Error(`Python pipeline exited with status ${submit.status}: ${text}`)
  }
  const ack = (await submit.json()) as { status?: string; runId?: string } & Partial<ReviewResult>

  // No runId: an agents service predating async mode returned the review itself.
  if (!ack.runId) {
    if (ack.file_reviews) return ack as ReviewResult
    throw new Error(
      `agents /review returned neither an ack nor a result: ${JSON.stringify(ack).slice(0, 300)}`,
    )
  }

  for (;;) {
    if (deadlineMs > 0 && Date.now() - startedAt >= deadlineMs) {
      throw new Error(
        `review run ${ack.runId} exceeded the ${deadlineMs}ms deadline; recorded failed rather ` +
          `than left running forever`,
      )
    }
    await sleep(pollIntervalMs)

    let res: Response
    try {
      res = await fetchFn(`${baseUrl}/review/runs/${ack.runId}`, { headers: await headersFn() })
    } catch {
      // One failed poll is not a failed review — keep polling until the deadline.
      continue
    }
    if (res.status === 404) {
      throw new Error(
        'agents service no longer knows this review run — it likely restarted mid-review',
      )
    }
    if (!res.ok) continue

    const state = (await res.json()) as
      | { status: 'running' }
      | { status: 'failed'; error?: string }
      | { status: 'complete'; result: ReviewResult }
    if (state.status === 'running') continue
    if (state.status === 'failed') {
      throw new Error(`review failed on the agents side: ${state.error ?? 'no reason recorded'}`)
    }
    return state.result
  }
}
