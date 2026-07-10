import { describe, it, expect, vi } from 'vitest'
import { fetchPRContext } from './pr-fetcher.js'

const mockPR = {
  number: 42,
  title: 'Fix auth bug',
  body: 'Fixes SQL injection in login',
  head: { sha: 'abcdef123456' },
}

const mockFiles = [
  {
    filename: 'src/auth.py',
    patch: "+query = f'SELECT * FROM users WHERE id={uid}'",
    additions: 1,
    deletions: 0,
    status: 'modified',
  },
  {
    filename: 'src/README.md',
    patch: undefined,
    additions: 0,
    deletions: 0,
    status: 'modified',
  },
]

function makeOctokit() {
  return {
    rest: {
      pulls: {
        get: vi.fn().mockResolvedValue({ data: mockPR }),
        listFiles: vi.fn().mockResolvedValue({ data: mockFiles }),
      },
      repos: {
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
      }
    },
  }
}

describe('fetchPRContext', () => {
  it('maps GitHub PR + files to PRContext', async () => {
    const octokit = makeOctokit()
    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)
    expect(result.repo).toBe('acme/api')
    expect(result.pr_number).toBe(42)
    expect(result.title).toBe('Fix auth bug')
    expect(result.description).toBe('Fixes SQL injection in login')
  })

  it('skips files with no patch (binary files)', async () => {
    const octokit = makeOctokit()
    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('src/auth.py')
  })

  it('sets description to empty string when PR body is null', async () => {
    const octokit = makeOctokit()
    ;(octokit.rest.pulls.get as any).mockResolvedValue({ data: { ...mockPR, body: null } })
    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)
    expect(result.description).toBe('')
  })
})
