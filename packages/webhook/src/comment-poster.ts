import type { Octokit } from '@octokit/core'
import type { ReviewComment, ReviewResult } from './types.js'

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

  const validComments = allComments
    .filter((c) => c.line >= 1 && c.line <= MAX_VALID_LINE)
    .map((c) => ({
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
      comments: validComments,
    })
  } catch (err: any) {
    if (err?.status === 422 && validComments.length > 0) {
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
