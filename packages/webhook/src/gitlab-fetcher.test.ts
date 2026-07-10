import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const CHANGES_RESPONSE = {
  changes: [
    {
      new_path: 'src/auth.ts',
      old_path: 'src/auth.ts',
      diff: '@@ -1,2 +1,3 @@\n-const a = 1\n+const a = 2\n+const b = 3\n',
      new_file: false,
      deleted_file: false,
      renamed_file: false,
    },
    {
      new_path: 'assets/logo.png',
      old_path: 'assets/logo.png',
      diff: '',
      new_file: false,
      deleted_file: false,
      renamed_file: false,
    },
    {
      new_path: 'scripts/run.py',
      old_path: 'scripts/run.py',
      diff: '@@ -0,0 +1 @@\n+print("hi")\n',
      new_file: true,
      deleted_file: false,
      renamed_file: false,
    },
  ],
}

const PAYLOAD = {
  project: { id: 42, path_with_namespace: 'acme/api' },
  object_attributes: { iid: 7, title: 'Add auth', description: 'Adds auth module' },
}

function makeFetch(json: unknown = CHANGES_RESPONSE, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  })
}

async function loadFetcher() {
  return await import('./gitlab-fetcher.js')
}

describe('fetchGitLabMRContext', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('GITLAB_ACCESS_TOKEN', 'glpat-test-token')
    delete process.env.GITLAB_URL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns mapped FileChange[] from the changes endpoint', async () => {
    const mockFetch = makeFetch()
    vi.stubGlobal('fetch', mockFetch)
    const { fetchGitLabMRContext } = await loadFetcher()

    const ctx = await fetchGitLabMRContext(42, 7, PAYLOAD)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/42/merge_requests/7/changes',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Private-Token': 'glpat-test-token' }),
      })
    )
    expect(ctx.repo).toBe('acme/api')
    expect(ctx.pr_number).toBe(7)
    expect(ctx.title).toBe('Add auth')
    expect(ctx.description).toBe('Adds auth module')

    const tsFile = ctx.files.find((f) => f.path === 'src/auth.ts')
    expect(tsFile).toBeDefined()
    expect(tsFile!.patch).toBe(CHANGES_RESPONSE.changes[0].diff)
    expect(tsFile!.language).toBe('typescript')
    expect(tsFile!.status).toBe('modified')
    expect(tsFile!.additions).toBe(2)
    expect(tsFile!.deletions).toBe(1)
  })

  it('skips binary files (entries with an empty diff)', async () => {
    vi.stubGlobal('fetch', makeFetch())
    const { fetchGitLabMRContext } = await loadFetcher()

    const ctx = await fetchGitLabMRContext(42, 7, PAYLOAD)

    expect(ctx.files).toHaveLength(2)
    expect(ctx.files.some((f) => f.path === 'assets/logo.png')).toBe(false)
  })

  it("sets status 'added' for new files and infers python language", async () => {
    vi.stubGlobal('fetch', makeFetch())
    const { fetchGitLabMRContext } = await loadFetcher()

    const ctx = await fetchGitLabMRContext(42, 7, PAYLOAD)

    const pyFile = ctx.files.find((f) => f.path === 'scripts/run.py')
    expect(pyFile).toBeDefined()
    expect(pyFile!.status).toBe('added')
    expect(pyFile!.language).toBe('python')
  })

  it('respects GITLAB_URL for self-hosted instances', async () => {
    vi.stubEnv('GITLAB_URL', 'https://gitlab.example.com')
    const mockFetch = makeFetch()
    vi.stubGlobal('fetch', mockFetch)
    const { fetchGitLabMRContext } = await loadFetcher()

    await fetchGitLabMRContext(42, 7, PAYLOAD)

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://gitlab.example.com/api/v4/projects/42/merge_requests/7/changes'
    )
  })

  it('throws when the GitLab API responds with an error status', async () => {
    vi.stubGlobal('fetch', makeFetch({ message: 'not found' }, false, 404))
    const { fetchGitLabMRContext } = await loadFetcher()

    await expect(fetchGitLabMRContext(42, 7, PAYLOAD)).rejects.toThrow(/404/)
  })

  it('detects languages beyond the original short list (rust, java, etc.) instead of falling back to "other"', async () => {
    const response = {
      changes: [
        { new_path: 'src/lib.rs', old_path: 'src/lib.rs', diff: '+fn main() {}', new_file: false, deleted_file: false, renamed_file: false },
        { new_path: 'src/Main.java', old_path: 'src/Main.java', diff: '+class Main {}', new_file: false, deleted_file: false, renamed_file: false },
      ],
    }
    vi.stubGlobal('fetch', makeFetch(response))
    const { fetchGitLabMRContext } = await loadFetcher()

    const ctx = await fetchGitLabMRContext(42, 7, PAYLOAD)

    expect(ctx.files.find((f) => f.path === 'src/lib.rs')!.language).toBe('rust')
    expect(ctx.files.find((f) => f.path === 'src/Main.java')!.language).toBe('java')
  })
})
