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

  it('paginates past the 100-file-per-page limit instead of truncating', async () => {
    const octokit = makeOctokit()
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      patch: `+line${i}`,
      additions: 1,
      deletions: 0,
      status: 'modified',
    }))
    const page2 = [
      { filename: 'src/last.ts', patch: '+final', additions: 1, deletions: 0, status: 'modified' },
    ]
    ;(octokit.rest.pulls.listFiles as any)
      .mockResolvedValueOnce({ data: page1 })
      .mockResolvedValueOnce({ data: page2 })

    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)

    expect(octokit.rest.pulls.listFiles).toHaveBeenCalledTimes(2)
    expect(octokit.rest.pulls.listFiles).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ page: 1, per_page: 100 })
    )
    expect(octokit.rest.pulls.listFiles).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: 2, per_page: 100 })
    )
    expect(result.files).toHaveLength(101)
    expect(result.files[100].path).toBe('src/last.ts')
  })
})
