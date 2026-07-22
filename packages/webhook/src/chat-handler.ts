import type { Octokit } from '@octokit/core'
import { getServiceConfig } from './config.js'
import { prisma } from './db.js'
import { evaluateBillingGate } from './billing.js'
import { logger } from './logger.js'
import { internalAuthHeaders } from './internal-auth.js'

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

  // Process Agent Actions (e.g. saving memory).
  //
  // TENANCY + CAPS (review finding B6, fixed 2026-07-21). This used to resolve
  // the repo with `prisma.repository.findFirst({ where: { fullName } })` — NO
  // installationId scoping — and then create the AgentMemory row inline, with
  // no size cap and no row cap. Two installations with identically-named repos
  // collide and whichever row the DB returns first wins, so a chat reply in
  // one tenant could write a memory into another tenant's repo; those rows are
  // then re-injected into that tenant's every future review prompt
  // (fetchProjectMemories -> agents/base.py). The guard, the caps and the
  // canonical sink redaction all belong to the sink, not to one caller, so
  // this path now goes through the SAME saveAgentMemory used by
  // POST /internal/memory — making memory-write.ts's "ONE real write path"
  // claim true rather than aspirational.
  if (response.actions && response.actions.length > 0) {
    const repoFullName = `${payload.repository.owner.login}/${payload.repository.name}`
    const { saveAgentMemory } = await import('./memory-write.js')
    for (const action of response.actions) {
      if (action.type !== 'save_memory') continue
      // No installation on the payload == no tenant identity == no write.
      // Fail closed: previously this still wrote, resolving the repo by name
      // alone. GitHub always sends `installation` for App-delivered events,
      // so this costs nothing legitimate.
      const result = await saveAgentMemory({
        installationExternalId: installationId ?? NaN,
        repoFullName,
        kind: action.kind || 'terminology',
        title: action.title || 'Rule',
        body: action.body,
      })
      if (result.ok) {
        log.info({ repoFullName, installationId }, 'Saved memory')
      } else {
        // Honest logging: a rejected write is never reported as saved.
        log.warn({ repoFullName, installationId, reason: result.reason }, 'Memory write rejected')
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
      headers: { 'Content-Type': 'application/json', ...(await internalAuthHeaders()) },
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
