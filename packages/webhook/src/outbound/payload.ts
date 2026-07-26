// Renders the outbound webhook body. Mirrors SuperLog's two-event model: a
// single `review.created` plus `review.updated` discriminated by `change.kind`.
// Every payload carries a pre-rendered `message.{title,body}` so the simplest
// consumer (a Slack/Discord relay) can forward it verbatim without parsing the
// structured block — SuperLog's most-copied idea.

export interface WebhookReviewSummary {
  id: string
  prNumber: number
  repositoryFullName: string
  riskLevel: string
}

export type WebhookEvent = 'review.created' | 'review.updated'

/** Discriminated change carried on `review.updated`. Each Areté trigger maps to
 *  exactly one kind (see docs/superpowers/specs/2026-07-15-outbound-webhooks-design.md §2). */
export type WebhookChange =
  | { kind: 'verdict_ready'; verdict: string; summary: string }
  | { kind: 'approval_requested'; approval: { id: string; command: string; reason: string } }
  | { kind: 'approval_executed'; approval: { id: string; executedAtIso: string } }
  | { kind: 'comment_resolved'; comment: { id: string; path: string; line: number; reason: string } }
  | { kind: 'review_failed'; failureReason: string }

export interface RenderWebhookInput {
  event: WebhookEvent
  review: WebhookReviewSummary
  occurredAtIso: string
  change?: WebhookChange
}

export interface WebhookPayload {
  event: WebhookEvent
  occurred_at: string
  change?: WebhookChange
  review: {
    id: string
    pr_number: number
    repository: string
    risk_level: string
  }
  message: { title: string; body: string }
}

function renderMessage(input: RenderWebhookInput): { title: string; body: string } {
  const { review, change } = input
  const ref = `${review.repositoryFullName} #${review.prNumber}`

  if (!change) {
    return {
      title: `Review started · ${ref}`,
      body: `Areté started a review of ${ref} (risk: ${review.riskLevel}).`,
    }
  }

  switch (change.kind) {
    case 'verdict_ready':
      return {
        title: `Review verdict: ${change.verdict} · ${ref}`,
        body: change.summary,
      }
    case 'approval_requested':
      return {
        title: `Approval requested · ${ref}`,
        body: `${change.approval.reason}\n\nCommand: ${change.approval.command}`,
      }
    case 'approval_executed':
      return {
        title: `Approval executed · ${ref}`,
        body: `Approval ${change.approval.id} was executed at ${change.approval.executedAtIso}.`,
      }
    case 'comment_resolved':
      return {
        title: `Comment resolved · ${ref}`,
        body: `${change.comment.path}:${change.comment.line} — ${change.comment.reason}`,
      }
    case 'review_failed':
      return {
        title: `Review failed · ${ref}`,
        body: `The review of ${ref} failed: ${change.failureReason}`,
      }
  }
}

export function renderWebhookPayload(input: RenderWebhookInput): WebhookPayload {
  return {
    event: input.event,
    occurred_at: input.occurredAtIso,
    ...(input.change ? { change: input.change } : {}),
    review: {
      id: input.review.id,
      pr_number: input.review.prNumber,
      repository: input.review.repositoryFullName,
      risk_level: input.review.riskLevel,
    },
    message: renderMessage(input),
  }
}
