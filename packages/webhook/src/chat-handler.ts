import type { Octokit } from '@octokit/core'
import { getServiceConfig } from './config.js'
import { prisma } from './db.js'
import { evaluateBillingGate } from './billing.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'chat' })

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
  installation?: { id: number }
}

export async function handleReviewCommentEvent(
  octokit: Octokit,
  payload: PullRequestReviewCommentPayload
): Promise<void> {
  if (payload.action !== 'created' || payload.comment.user.type === 'Bot') {
    return
  }

  // Only ever reply when this comment is a reply to Areté's OWN bot comment.
  // A top-level review comment (no in_reply_to_id) is a human-to-human
  // conversation — jumping in would be noise, and previously this still ran
  // the whole chat pipeline with an empty bot_comment.
  if (!payload.comment.in_reply_to_id) {
    return
  }

  let botCommentBody = ''
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
    log.error({ err }, 'Error fetching original comment')
    return
  }

  // The parent comment exists but was not written by Areté's bot — this is a
  // reply in someone else's thread. Stay out of it.
  if (!botCommentBody) {
    return
  }

  // Billing gate — chat replies burn LLM cost just like reviews, so the same
  // rules apply (lapsed subscription, or 50 free reviews exhausted with no
  // active paid subscription). Evaluated BEFORE calling the chat pipeline.
  const installationId = payload.installation?.id
  if (installationId) {
    const installation = await prisma.installation.findUnique({
      where: { provider_externalId: { provider: 'github', externalId: installationId } },
    })
    const gate = evaluateBillingGate(installation)
    if (!gate.allowed) {
      log.info(
        { installationId, reason: gate.reason },
        'Chat reply blocked'
      )
      await (octokit as any).rest.pulls.createReplyForReviewComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        pull_number: payload.pull_request.number,
        comment_id: payload.comment.id,
        body: gate.message,
      })
      return
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

  const response = await runChatPipeline(context)
  const reply = response.reply || 'Sorry, I encountered an error formatting my response.'

  // Process Agent Actions (e.g. saving memory)
  if (response.actions && response.actions.length > 0) {
    const repoFullName = `${payload.repository.owner.login}/${payload.repository.name}`
    const repo = await prisma.repository.findFirst({
      where: { fullName: repoFullName }
    })
    
    if (repo) {
      for (const action of response.actions) {
        if (action.type === 'save_memory') {
          await prisma.agentMemory.create({
            data: {
              repositoryId: repo.id,
              kind: action.kind || 'terminology',
              title: action.title || 'Rule',
              body: action.body
            }
          })
          log.info({ repoFullName, title: action.title }, 'Saved memory')
        }
      }
    }
  }

  await (octokit as any).rest.pulls.createReplyForReviewComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pull_number: payload.pull_request.number,
    comment_id: payload.comment.id,
    body: reply,
  })
}

/**
 * Calls the Python /chat endpoint. Mirrors review-bridge.ts's timeout
 * pattern: a hung Python service must not hang the webhook process, so the
 * request is aborted after 120s. Exported for testing.
 */
export async function runChatPipeline(context: any): Promise<{ reply: string, actions?: any[] }> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 120_000)

  try {
    const baseUrl = getServiceConfig().pythonServiceUrl
    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      body: JSON.stringify(context),
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Chat Agent failed (code ${res.status}): ${errorText}`)
    }
    return await res.json()
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Chat pipeline timed out after 120s')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
