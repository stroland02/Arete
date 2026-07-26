// Dev-only runner: review a local diff through the REAL pipeline (scope §3.3).
//
//   pnpm --filter @arete/webhook dev:review [base]      base defaults to origin/main
//
// Shells `git diff <base>...HEAD`, builds the PRContext the production pipeline
// consumes, calls the same `runReviewPipeline` the webhook uses, and prints the
// findings. This is the review-side equivalent of the scan retest: it exercises
// `/review` end to end against real changes, which a GitHub-webhook-only path
// never could in dev.
//
// It needs the agents service running (it makes the real /review call) and an
// internal-token keyset configured — the same requirements as a production
// review, on purpose. A dev path that stubbed those would prove less than it
// claimed. On a missing model or unreachable service it prints the honest
// failure the pipeline raises, never a fabricated clean review.

import { execFileSync } from 'node:child_process'

import { runReviewPipeline } from '../review-bridge.js'
import { buildLocalPRContext } from './build-context.js'

function gitDiff(base: string): string {
  return execFileSync('git', ['diff', `${base}...HEAD`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

async function main(): Promise<number> {
  const base = process.argv[2] ?? 'origin/main'

  let diff: string
  try {
    diff = gitDiff(base)
  } catch (err) {
    console.error(`Could not diff against "${base}": ${(err as Error).message}`)
    return 1
  }

  const context = buildLocalPRContext(diff, { title: `Local review vs ${base}` })
  if (context.files.length === 0) {
    console.log(`No changes against ${base}. Nothing to review.`)
    return 0
  }

  console.log(`Reviewing ${context.files.length} changed file(s) against ${base}…`)
  console.log('(real /review call — the agents service and an internal-token keyset must be up)\n')

  let result
  try {
    result = await runReviewPipeline(context)
  } catch (err) {
    // The honest failure, not a swallowed one. A missing model, an unreachable
    // agents service, or an unconfigured keyset all surface here as themselves.
    console.error(`Review failed: ${(err as Error).message}`)
    return 1
  }

  // ReviewComment already carries its own `path`; the file_review path is the
  // same value, so the comment's field is authoritative here.
  const comments = result.file_reviews.flatMap((fr) => fr.comments)
  console.log(`Risk: ${result.risk_level.toUpperCase()}  ·  ${comments.length} finding(s)\n`)
  for (const c of comments) {
    console.log(`  [${c.severity.toUpperCase()}] ${c.category}  ${c.path}:${c.line}`)
    console.log(`    ${c.body.split('\n')[0]}`)
  }
  if (comments.length === 0) {
    console.log('  No findings. (An empty review is honest, not an error.)')
  }
  console.log(`\n${result.overall_summary}`)
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
