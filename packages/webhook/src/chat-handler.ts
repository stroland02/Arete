import type { Octokit } from '@octokit/core'

interface PullRequestReviewCommentPayload {
  action: string
  comment: {
    id: number
    body: string
    user: { type: string; login: string }
    in_reply_to_id?: number
    diff_hunk: string
    path: string
  }
  pull_request: {
    number: number
    title: string
    body: string | null
  }
  repository: {
    owner: { login: string }
    name: string
  }
}

export async function handleReviewCommentEvent(
  octokit: Octokit,
  payload: PullRequestReviewCommentPayload
): Promise<void> {
  if (payload.action !== 'created' || payload.comment.user.type === 'Bot') {
    return
  }

  // We need to fetch the original bot comment if this is a reply
  let botCommentBody = ''
  if (payload.comment.in_reply_to_id) {
    try {
      const response = await (octokit as any).rest.pulls.getReviewComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        comment_id: payload.comment.in_reply_to_id,
      })
      if (response.data && response.data.user.type === 'Bot') {
        botCommentBody = response.data.body
      }
    } catch (err) {
      console.error('[chat-handler] Error fetching original comment:', err)
    }
  }

  const context = {
    pr_title: payload.pull_request.title,
    pr_description: payload.pull_request.body || '',
    file_path: payload.comment.path,
    diff_hunk: payload.comment.diff_hunk,
    bot_comment: botCommentBody,
    user_reply: payload.comment.body
  }

  const reply = await runChatPipeline(context)

  await (octokit as any).rest.pulls.createReplyForReviewComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pull_number: payload.pull_request.number,
    comment_id: payload.comment.id,
    body: reply,
  })
}

async function runChatPipeline(context: any): Promise<string> {
  const baseUrl = process.env.PYTHON_SERVICE_URL ?? 'http://127.0.0.1:8000'
  const res = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    body: JSON.stringify(context),
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Chat Agent failed (code ${res.status}): ${errorText}`)
  }
  return (await res.text()).trim()
}
