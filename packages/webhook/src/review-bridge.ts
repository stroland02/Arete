import type { PRContext, ReviewResult } from './types.js'
import { getServiceConfig } from './config.js'

export async function runReviewPipeline(prContext: PRContext): Promise<ReviewResult> {
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
