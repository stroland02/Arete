import type { Octokit } from '@octokit/core'
import type { ReviewComment, ReviewResult } from './types.js'
import { fingerprintComment } from './fingerprint.js'

// GitHub only allows inline comments on lines 1–1000 in a diff hunk.
const MAX_VALID_LINE = 1000

function formatComment(comment: ReviewComment): string {
  const badge = `**[${comment.severity.toUpperCase()}]** (${comment.category})`
  return `${badge}\n\n${comment.body}`
}

export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  result: ReviewResult
): Promise<void> {
  const allComments = result.file_reviews.flatMap((fr) => fr.comments)

  // Noise Classification (SP6): silenced/observed findings are excluded from
  // the GitHub post but still persisted (see persistence.ts's persistReview)
  // -- this is what makes silence_as_noise/place_under_observation's own
  // documented promise ("never posted to GitHub" / "stays quiet until the
  // escalation trigger trips") literally true.
  const openComments = allComments.filter((c) => (c.noise_state ?? 'OPEN') === 'OPEN')

  const validComments = openComments
    .filter((c) => c.line >= 1 && c.line <= MAX_VALID_LINE)

  // Superlog-inspired Fingerprinting: Group identical semantic comments in the same file
  // so the user isn't spammed with 15 identical "Missing auth check" comments.
  const seenFingerprints = new Set<string>()
  const dedupedComments = validComments.filter((c) => {
    const hash = fingerprintComment(c.body, c.category)
    const uniqueKey = `${c.path}:${hash}`
    if (seenFingerprints.has(uniqueKey)) {
      return false
    }
    seenFingerprints.add(uniqueKey)
    return true
  })

  const githubComments = dedupedComments.map((c) => ({
    path: c.path,
    line: c.line,
    body: formatComment(c),
  }))

  const riskBadge = `**Risk Level: ${result.risk_level.toUpperCase()}**`
  const body = `## Areté Code Review\n\n${riskBadge}\n\n${result.overall_summary}`

  try {
    await (octokit as any).rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body,
      event: 'COMMENT',
      comments: githubComments,
    })
  } catch (err: any) {
    if (err?.status === 422 && githubComments.length > 0) {
      // Inline comments reference lines outside the diff — post body-only
      await (octokit as any).rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        body,
        event: 'COMMENT',
        comments: [],
      })
    } else {
      throw err
    }
  }
}
