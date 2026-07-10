import type { ReviewComment, ReviewResult } from './types.js'
import { gitlabBaseUrl } from './gitlab-fetcher.js'

export interface DiffRefs {
  baseSha: string
  startSha: string
  headSha: string
}

function formatComment(comment: ReviewComment): string {
  const badge = `**[${comment.severity.toUpperCase()}]** (${comment.category})`
  return `${badge}\n\n${comment.body}`
}

export async function postGitLabReview(
  projectId: number,
  mrIid: number,
  result: ReviewResult,
  diffRefs: DiffRefs
): Promise<void> {
  const url = `${gitlabBaseUrl()}/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`
  const headers = {
    'Private-Token': process.env.GITLAB_ACCESS_TOKEN ?? '',
    'Content-Type': 'application/json',
  }

  const allComments = result.file_reviews.flatMap((fr) => fr.comments)

  for (const comment of allComments) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        body: formatComment(comment),
        position: {
          base_sha: diffRefs.baseSha,
          start_sha: diffRefs.startSha,
          head_sha: diffRefs.headSha,
          position_type: 'text',
          new_path: comment.path,
          new_line: comment.line,
        },
      }),
    })

    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        // Line likely outside the diff — skip this comment and keep going
        console.warn(
          `[gitlab-poster] Skipping comment on ${comment.path}:${comment.line} (status ${res.status})`
        )
        continue
      }
      throw new Error(`[gitlab-poster] Discussion post failed with status ${res.status}`)
    }
  }

  // Top-level summary note (no position)
  const riskBadge = `**Risk Level: ${result.risk_level.toUpperCase()}**`
  const summaryBody = `## Areté Code Review\n\n${riskBadge}\n\n${result.overall_summary}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body: summaryBody }),
  })

  if (!res.ok) {
    throw new Error(`[gitlab-poster] Summary note post failed with status ${res.status}`)
  }
}
