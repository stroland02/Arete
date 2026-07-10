import { describe, it, expect, vi } from 'vitest'
import { postReview } from './comment-poster.js'
import type { ReviewResult } from './types.js'

const MOCK_RESULT: ReviewResult = {
  pr_context: { repo: 'acme/api', pr_number: 1, title: 'Fix', description: '', files: [] },
  file_reviews: [
    {
      path: 'src/auth.py',
      comments: [
        {
          path: 'src/auth.py',
          line: 5,
          body: 'SQL injection risk.',
          severity: 'error',
          category: 'security',
        },
        {
          path: 'src/auth.py',
          line: 99999,
          body: 'Out of range line.',
          severity: 'info',
          category: 'quality',
        },
      ],
      summary: 'SQL injection found.',
    },
  ],
  overall_summary: 'Found 1 issue. Risk: HIGH.',
  risk_level: 'high',
  total_comments: 2,
}

function makeOctokit(createReviewFn = vi.fn().mockResolvedValue({})) {
  return { rest: { pulls: { createReview: createReviewFn } } }
}

describe('postReview', () => {
  it('calls createReview with overall_summary as body', async () => {
    const createReview = vi.fn().mockResolvedValue({})
    await postReview(makeOctokit(createReview) as any, 'acme', 'api', 1, MOCK_RESULT)
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Found 1 issue') })
    )
  })

  it('includes valid inline comments and drops out-of-range ones', async () => {
    const createReview = vi.fn().mockResolvedValue({})
    await postReview(makeOctokit(createReview) as any, 'acme', 'api', 1, MOCK_RESULT)
    const call = createReview.mock.calls[0][0]
    expect(call.comments).toHaveLength(1)
    expect(call.comments[0].line).toBe(5)
  })

  it('posts with event COMMENT', async () => {
    const createReview = vi.fn().mockResolvedValue({})
    await postReview(makeOctokit(createReview) as any, 'acme', 'api', 1, MOCK_RESULT)
    expect(createReview.mock.calls[0][0].event).toBe('COMMENT')
  })

  it('falls back to body-only when createReview returns 422', async () => {
    const createReview = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Unprocessable Entity'), { status: 422 }))
      .mockResolvedValueOnce({})
    await postReview(makeOctokit(createReview) as any, 'acme', 'api', 1, MOCK_RESULT)
    expect(createReview).toHaveBeenCalledTimes(2)
    // Second call must have empty comments
    expect(createReview.mock.calls[1][0].comments).toHaveLength(0)
  })
})
