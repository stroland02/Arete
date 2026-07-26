// Build a PRContext from a local `git diff`, so the review half of the product
// can be exercised without a real GitHub PR webhook (scope review §3.3).
//
// Reviews are the product's named feature and had never run locally — a Review
// needs a webhook we cannot fire in dev, so Overview's headline tiles were
// structurally blank. This turns a local diff into exactly the PRContext the
// production pipeline consumes, so `runReviewPipeline` runs against real changes
// on the dogfood instance the same way the scan retest drove `/scan`.
//
// This module is PURE — it parses text, touches no disk and no network. The
// thin runner beside it shells `git diff` and calls the real pipeline; keeping
// the parse separate is what makes the fiddly part testable.

import type { FileChange, PRContext } from '../types.js'

// Extension → the language label the agents prompt uses. Not exhaustive: an
// unknown extension yields '' rather than a guess, because a wrong language
// label misdirects the specialist more than an absent one.
const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  sql: 'sql',
  sh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  md: 'markdown',
  prisma: 'prisma',
}

function languageOf(path: string): string {
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
  return LANGUAGE_BY_EXT[ext] ?? ''
}

/**
 * Split unified `git diff` output into one entry per file.
 *
 * Splits on the `diff --git` marker git writes before every file, and reads the
 * path from the `+++ b/…` line rather than the marker: a rename or a path with
 * spaces is unambiguous on the `+++` line, and `/dev/null` there means the file
 * was deleted, which is recorded as status `removed` rather than pointed at a
 * nonexistent path.
 */
export function parseDiff(diffText: string): FileChange[] {
  if (!diffText.trim()) return []

  const chunks = diffText.split(/^diff --git .*$/m).slice(1)
  const files: FileChange[] = []

  for (const chunk of chunks) {
    const plusLine = chunk.match(/^\+\+\+ (?:b\/)?(.*)$/m)?.[1]?.trim()
    const minusLine = chunk.match(/^--- (?:a\/)?(.*)$/m)?.[1]?.trim()

    const removed = plusLine === '/dev/null'
    const added = minusLine === '/dev/null'
    const path = removed ? minusLine : plusLine
    if (!path || path === '/dev/null') continue

    // Count only body +/- lines, never the `+++`/`---` headers, which also
    // begin with those characters and would inflate every file by one each.
    let additions = 0
    let deletions = 0
    for (const line of chunk.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
      else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
    }

    files.push({
      path,
      patch: chunk.replace(/^\n/, '').trimEnd(),
      additions,
      deletions,
      language: languageOf(path),
      status: added ? 'added' : removed ? 'removed' : 'modified',
    })
  }

  return files
}

export interface LocalReviewMeta {
  repo?: string
  prNumber?: number
  title?: string
  description?: string
  installationId?: number
}

/**
 * Assemble a PRContext for a local diff.
 *
 * `pr_number: 0` is deliberate and honest: there is no PR. A dev review is a
 * review of a working tree, and stamping a fake PR number would be the kind of
 * fabricated identifier the product exists to avoid. Callers that persist the
 * result must treat 0 as "local, not a real PR", never look it up on GitHub.
 */
export function buildLocalPRContext(diffText: string, meta: LocalReviewMeta = {}): PRContext {
  const files = parseDiff(diffText)
  return {
    repo: meta.repo ?? 'local/working-tree',
    pr_number: meta.prNumber ?? 0,
    title: meta.title ?? 'Local diff review',
    description:
      meta.description ??
      `Dev review of ${files.length} changed file(s) against a local base. No pull request.`,
    files,
    ...(meta.installationId != null ? { installationId: meta.installationId } : {}),
  }
}
