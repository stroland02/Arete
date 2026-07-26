import { describe, expect, test } from 'vitest'
import { renderWebhookPayload, type WebhookReviewSummary } from './payload.js'

const REVIEW: WebhookReviewSummary = {
  id: 'rev_123',
  prNumber: 42,
  repositoryFullName: 'acme/rocket',
  riskLevel: 'medium',
}
const AT = '2026-07-15T12:00:00.000Z'

describe('renderWebhookPayload — envelope', () => {
  test('echoes event, timestamp and a structured review block', () => {
    const p = renderWebhookPayload({ event: 'review.created', review: REVIEW, occurredAtIso: AT })
    expect(p.event).toBe('review.created')
    expect(p.occurred_at).toBe(AT)
    expect(p.review).toEqual({
      id: 'rev_123',
      pr_number: 42,
      repository: 'acme/rocket',
      risk_level: 'medium',
    })
  })

  test('review.created has no change discriminator and a render-ready message', () => {
    const p = renderWebhookPayload({ event: 'review.created', review: REVIEW, occurredAtIso: AT })
    expect(p.change).toBeUndefined()
    expect(p.message.title).toBe('Review started · acme/rocket #42')
    expect(typeof p.message.body).toBe('string')
    expect(p.message.body.length).toBeGreaterThan(0)
  })
})

describe('renderWebhookPayload — review.updated change.kind', () => {
  test('verdict_ready carries the verdict and renders it into the message', () => {
    const p = renderWebhookPayload({
      event: 'review.updated',
      review: REVIEW,
      occurredAtIso: AT,
      change: { kind: 'verdict_ready', verdict: 'comment', summary: 'Two nits, no blockers.' },
    })
    expect(p.event).toBe('review.updated')
    expect(p.change).toEqual({ kind: 'verdict_ready', verdict: 'comment', summary: 'Two nits, no blockers.' })
    expect(p.message.title).toBe('Review verdict: comment · acme/rocket #42')
    expect(p.message.body).toContain('Two nits, no blockers.')
  })

  test('approval_requested surfaces the command in the body', () => {
    const p = renderWebhookPayload({
      event: 'review.updated',
      review: REVIEW,
      occurredAtIso: AT,
      change: {
        kind: 'approval_requested',
        approval: { id: 'ap_1', command: 'terraform apply', reason: 'scale up workers' },
      },
    })
    expect(p.change).toMatchObject({ kind: 'approval_requested' })
    expect(p.message.title).toBe('Approval requested · acme/rocket #42')
    expect(p.message.body).toContain('terraform apply')
  })

  test('review_failed surfaces the failure reason', () => {
    const p = renderWebhookPayload({
      event: 'review.updated',
      review: REVIEW,
      occurredAtIso: AT,
      change: { kind: 'review_failed', failureReason: 'pipeline timed out after 120s' },
    })
    expect(p.message.title).toBe('Review failed · acme/rocket #42')
    expect(p.message.body).toContain('pipeline timed out after 120s')
  })
})
