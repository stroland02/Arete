import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReviewResult } from './types.js'

const MOCK_RESULT: ReviewResult = {
  pr_context: { repo: 'acme/api', pr_number: 7, title: 'Add auth', description: '', files: [] },
  file_reviews: [
    {
      path: 'src/auth.ts',
      comments: [
        {
          path: 'src/auth.ts',
          line: 5,
          body: 'SQL injection risk.',
          severity: 'error',
          category: 'security',
        },
        {
          path: 'src/auth.ts',
          line: 12,
          body: 'Missing null check.',
          severity: 'warning',
          category: 'quality',
        },
      ],
      summary: 'Two issues found.',
    },
  ],
  overall_summary: 'Found 2 issues. Risk: HIGH.',
  risk_level: 'high',
  total_comments: 2,
}

const DIFF_REFS = { baseSha: 'base-sha-aaa', startSha: 'start-sha-bbb', headSha: 'head-sha-ccc' }

function okResponse() {
  return { ok: true, status: 201, json: async () => ({}), text: async () => '{}' }
}

function errorResponse(status: number) {
  return { ok: false, status, json: async () => ({}), text: async () => 'error' }
}

async function loadPoster() {
  return await import('./gitlab-comment-poster.js')
}

describe('postGitLabReview', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('GITLAB_ACCESS_TOKEN', 'glpat-test-token')
    delete process.env.GITLAB_URL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('posts one discussion per comment with position and diff refs', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', mockFetch)
    const { postGitLabReview } = await loadPoster()

    await postGitLabReview(42, 7, MOCK_RESULT, DIFF_REFS)

    // 2 comment discussions + 1 summary note
    expect(mockFetch).toHaveBeenCalledTimes(3)

    const firstCall = mockFetch.mock.calls[0]
    expect(firstCall[0]).toBe('https://gitlab.com/api/v4/projects/42/merge_requests/7/discussions')
    expect(firstCall[1].method).toBe('POST')
    expect(firstCall[1].headers).toMatchObject({ 'Private-Token': 'glpat-test-token' })

    const firstBody = JSON.parse(firstCall[1].body)
    expect(firstBody.body).toContain('SQL injection risk.')
    expect(firstBody.position).toEqual({
      base_sha: 'base-sha-aaa',
      start_sha: 'start-sha-bbb',
      head_sha: 'head-sha-ccc',
      position_type: 'text',
      new_path: 'src/auth.ts',
      new_line: 5,
    })

    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(secondBody.position.new_line).toBe(12)
  })

  it('posts a summary note (no position) after all comments', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', mockFetch)
    const { postGitLabReview } = await loadPoster()

    await postGitLabReview(42, 7, MOCK_RESULT, DIFF_REFS)

    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
    const lastBody = JSON.parse(lastCall[1].body)
    expect(lastBody.body).toContain('Found 2 issues. Risk: HIGH.')
    expect(lastBody.position).toBeUndefined()
  })

  it('skips comments that fail with 4xx without throwing and still posts the rest', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(400)) // first comment: line out of range
      .mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', mockFetch)
    const { postGitLabReview } = await loadPoster()

    await expect(postGitLabReview(42, 7, MOCK_RESULT, DIFF_REFS)).resolves.toBeUndefined()

    // Both comments attempted plus the summary note
    expect(mockFetch).toHaveBeenCalledTimes(3)
    const lastBody = JSON.parse(mockFetch.mock.calls[2][1].body)
    expect(lastBody.position).toBeUndefined()
  })

  it('throws on server errors (5xx) when posting a comment', async () => {
    const mockFetch = vi.fn().mockResolvedValue(errorResponse(500))
    vi.stubGlobal('fetch', mockFetch)
    const { postGitLabReview } = await loadPoster()

    await expect(postGitLabReview(42, 7, MOCK_RESULT, DIFF_REFS)).rejects.toThrow(/500/)
  })

  it('respects GITLAB_URL for self-hosted instances', async () => {
    vi.stubEnv('GITLAB_URL', 'https://gitlab.example.com')
    const mockFetch = vi.fn().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', mockFetch)
    const { postGitLabReview } = await loadPoster()

    await postGitLabReview(42, 7, MOCK_RESULT, DIFF_REFS)

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://gitlab.example.com/api/v4/projects/42/merge_requests/7/discussions'
    )
  })
})
