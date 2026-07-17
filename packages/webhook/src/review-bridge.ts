import type { PRContext, ReviewResult } from './types.js'
import { getServiceConfig } from './config.js'
import {
  resolveModelConnectionForReview,
  defaultResolveModelDeps,
  companionDefault,
  type ResolvedModelConnection,
} from './resolve-model-connection.js'

export interface ReviewBridgeDeps {
  /** Resolve the tenant's model connection from the numeric installation id.
   *  Injected in tests; defaults to the real Prisma-backed resolver. */
  resolveModel?: (externalInstallationId: number) => Promise<ResolvedModelConnection>
}

export async function runReviewPipeline(
  prContext: PRContext,
  deps: ReviewBridgeDeps = {},
): Promise<ReviewResult> {
  // Single /review choke point: resolve the tenant's Bring-Your-Own model
  // connection here so every review path carries {provider, model, apiKey,
  // baseUrl} without each caller remembering to. Guarded on installationId (unit
  // paths that omit it are unaffected). Resolution must never block a review — on
  // any failure we fall back to the keyless Ollama companion default.
  if (prContext.installationId != null && prContext.modelConnection == null) {
    const resolve =
      deps.resolveModel ??
      ((id: number) => resolveModelConnectionForReview(id, defaultResolveModelDeps()))
    try {
      prContext.modelConnection = await resolve(prContext.installationId)
    } catch (err) {
      console.error('[review-bridge] model-connection resolve failed; using companion default:', err)
      prContext.modelConnection = companionDefault()
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 120_000)

  try {
    const baseUrl = getServiceConfig().pythonServiceUrl
    const res = await fetch(`${baseUrl}/review`, {
      method: 'POST',
      body: JSON.stringify(prContext),
      headers: { 'Content-Type': 'application/json' },
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
