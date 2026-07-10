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
    vi.doMock('@arete/db', () => {
      const PrismaClient = vi.fn()
      PrismaClient.prototype.installation = {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: 'inst-uuid-1' }),
        update: vi.fn().mockResolvedValue({}),
      }
      PrismaClient.prototype.repository = { upsert: vi.fn().mockResolvedValue({ id: 'repo-uuid-1' }) }
      PrismaClient.prototype.review = { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }
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
    vi.doMock('@arete/db', () => {
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

  it('marks the check run as failed instead of leaving it stuck in_progress when the pipeline throws', async () => {
    const mockFetch = vi.fn().mockResolvedValue(MOCK_PR_CONTEXT)
    const mockRun = vi.fn().mockRejectedValue(new Error('Python pipeline timed out after 120s'))
    const mockPost = vi.fn()
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
    vi.doMock('@arete/db', () => {
      const PrismaClient = vi.fn()
      return { PrismaClient }
    })

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await expect(
      handlePullRequestEvent(mockOctokit as any, {
        repository: { id: 123, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
        pull_request: { number: 1, head: { sha: 'abcdef' } },
        action: 'opened',
      })
    ).rejects.toThrow('Python pipeline timed out after 120s')

    expect(mockPost).not.toHaveBeenCalled()
    expect(mockChecksUpdate).toHaveBeenCalledTimes(1)
    expect(mockChecksUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        check_run_id: 999,
        status: 'completed',
        conclusion: 'failure',
        output: expect.objectContaining({
          title: 'Review Failed',
          summary: expect.stringContaining('Python pipeline timed out after 120s'),
        }),
      })
    )
  })
})
