import type { PRContext, ReviewResult } from './types.js'
import { getServiceConfig, getModelConfig } from './config.js'
import { resolveInstallationModelConfig } from './model-config.js'

export async function runReviewPipeline(prContext: PRContext): Promise<ReviewResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 120_000)

  try {
    const baseUrl = getServiceConfig().pythonServiceUrl
    // Resolve the BYO model config to forward as the agents /review `llm` block.
    // Precedence: explicit context config > per-installation "connect your
    // model" config (DB) > deployment env config > none (agents service then
    // uses its own default / Ollama safety fallback).
    let llm: PRContext['llm'] = prContext.llm
    if (!llm && prContext.installationId != null) {
      llm = await resolveInstallationModelConfig(prContext.installationId)
    }
    if (!llm) llm = getModelConfig()
    const body = llm ? { ...prContext, llm } : prContext
    const res = await fetch(`${baseUrl}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
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
