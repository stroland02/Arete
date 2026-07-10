import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { PRContext, ReviewResult } from './types.js'

const AGENTS_DIR = resolve(__dirname, '../../agents')

export function runReviewPipeline(prContext: PRContext): Promise<ReviewResult> {
  return new Promise((resolve2, reject) => {
    const proc = spawn('uv', ['run', 'python', '-m', 'arete_agents.cli'], {
      cwd: AGENTS_DIR,
    })

    let stdout = ''
    let stderr = ''

    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error('Python pipeline timed out after 120s'))
    }, 120_000)

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('error', reject)

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        console.error('[review-bridge] Python stderr:', stderr)
        reject(new Error(`Python pipeline exited with code ${code}: ${stderr.slice(0, 200)}`))
        return
      }
      try {
        resolve2(JSON.parse(stdout) as ReviewResult)
      } catch (err) {
        reject(new Error(`Failed to parse pipeline output: ${err}`))
      }
    })

    proc.stdin.write(JSON.stringify(prContext))
    proc.stdin.end()
  })
}
