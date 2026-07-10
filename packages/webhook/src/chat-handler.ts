import type { Octokit } from '@octokit/core'
import { spawn } from 'child_process'
import path from 'path'

const AGENTS_DIR = path.resolve(__dirname, '../../agents')

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

function runChatPipeline(context: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify(context)
    const proc = spawn('uv', ['run', 'python', '-m', 'arete_agents.cli', '--mode', 'chat'], {
      cwd: AGENTS_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`Chat Agent failed (code ${code}): ${stderr}`))
    })

    proc.on('error', reject)

    proc.stdin.write(input)
    proc.stdin.end()
  })
}
