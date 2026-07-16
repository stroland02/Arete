import type { PRContext, ReviewResult } from './types.js'
import { getServiceConfig, getModelConfig } from './config.js'

export async function runReviewPipeline(prContext: PRContext): Promise<ReviewResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 120_000)

  try {
    const baseUrl = getServiceConfig().pythonServiceUrl
    // Forward the deployment-level BYO model config (when configured) as the
    // agents /review `llm` block — unless the context already carries one.
    // Omitted -> the agents service uses its own default / Ollama fallback.
    const modelConfig = getModelConfig()
    const body = prContext.llm || !modelConfig ? prContext : { ...prContext, llm: modelConfig }
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
