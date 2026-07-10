import { describe, it, expect, vi, beforeEach } from 'vitest'

const MOCK_PR_CONTEXT = {
  repo: 'acme/api', pr_number: 1, title: 'Fix', description: '', files: [],
}
const MOCK_RESULT = {
  pr_context: MOCK_PR_CONTEXT,
  file_reviews: [],
  overall_summary: 'OK',
  risk_level: 'low',
  total_comments: 0,
}

describe('handlePullRequestEvent', () => {
  beforeEach(() => { vi.resetModules() })

  it('fetches PR, runs pipeline, posts review', async () => {
    const mockFetch = vi.fn().mockResolvedValue(MOCK_PR_CONTEXT)
    const mockRun = vi.fn().mockResolvedValue(MOCK_RESULT)
    const mockPost = vi.fn().mockResolvedValue(undefined)
    const mockChecksCreate = vi.fn().mockResolvedValue({ data: { id: 999 } })
    const mockChecksUpdate = vi.fn().mockResolvedValue({})
    const mockOctokit = {
      rest: {
        checks: {
          create: mockChecksCreate,
          update: mockChecksUpdate
        }
      }
    }

    vi.doMock('./pr-fetcher.js', () => ({ fetchPRContext: mockFetch }))
    vi.doMock('./review-bridge.js', () => ({ runReviewPipeline: mockRun }))
    vi.doMock('./comment-poster.js', () => ({ postReview: mockPost }))
    vi.doMock('./generated/prisma/client.js', () => {
      const PrismaClient = vi.fn()
      PrismaClient.prototype.$transaction = vi.fn().mockResolvedValue([])
      PrismaClient.prototype.installation = { findFirst: vi.fn(), upsert: vi.fn() }
      PrismaClient.prototype.repository = { upsert: vi.fn() }
      PrismaClient.prototype.review = { create: vi.fn() }
      return { PrismaClient }
    })

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent(mockOctokit as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'abcdef' } },
      action: 'opened',
    })

    expect(mockFetch).toHaveBeenCalledWith(mockOctokit, 'acme', 'api', 1)
    expect(mockRun).toHaveBeenCalledWith(MOCK_PR_CONTEXT)
    expect(mockPost).toHaveBeenCalledWith(mockOctokit, 'acme', 'api', 1, MOCK_RESULT)
  })

  it('does not run pipeline for closed PRs', async () => {
    const mockRun = vi.fn()
    vi.doMock('./review-bridge.js', () => ({ runReviewPipeline: mockRun }))
    vi.doMock('./generated/prisma/client.js', () => {
      const PrismaClient = vi.fn()
      return { PrismaClient }
    })

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({} as any, {
      repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
      pull_request: { number: 1, head: { sha: 'abcdef' } },
      action: 'closed',
    })

    expect(mockRun).not.toHaveBeenCalled()
  })
})
