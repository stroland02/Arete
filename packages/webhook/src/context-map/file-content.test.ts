import { describe, it, expect, vi } from 'vitest'
import { isSafeRepoPath, fetchRepoFileContent, type FileContentDeps } from './file-content.js'

describe('isSafeRepoPath', () => {
  it('accepts normal repo-relative paths', () => {
    expect(isSafeRepoPath('src/auth/a.ts')).toBe(true)
    expect(isSafeRepoPath('README.md')).toBe(true)
    expect(isSafeRepoPath('.github/workflows/ci.yml')).toBe(true)
  })
  it('rejects empty, absolute, and drive-letter paths', () => {
    expect(isSafeRepoPath('')).toBe(false)
    expect(isSafeRepoPath('/etc/passwd')).toBe(false)
    expect(isSafeRepoPath('C:/windows/system32')).toBe(false)
  })
  it('rejects traversal, backslashes, NUL, and empty segments', () => {
    expect(isSafeRepoPath('..')).toBe(false)
    expect(isSafeRepoPath('a/../b')).toBe(false)
    expect(isSafeRepoPath('a\\b')).toBe(false)
    expect(isSafeRepoPath('a\0b')).toBe(false)
    expect(isSafeRepoPath('a//b')).toBe(false)
  })
})

const REPO = { owner: 'acme', repo: 'payments-api' }

function deps(over: Partial<FileContentDeps> = {}): FileContentDeps {
  return {
    resolveRepo: vi.fn(async () => REPO),
    getContent: vi.fn(async () => ({
      type: 'file',
      content: Buffer.from('export const x = 1\n').toString('base64'),
      encoding: 'base64',
      size: 19,
    })),
    ...over,
  }
}

describe('fetchRepoFileContent', () => {
  it('returns the decoded text for a normal file', async () => {
    const result = await fetchRepoFileContent({ externalInstallationId: 42, path: 'src/a.ts' }, deps())
    expect(result).toEqual({ ok: true, path: 'src/a.ts', text: 'export const x = 1\n', truncated: false })
  })

  it('rejects an unsafe path WITHOUT touching the repo or GitHub', async () => {
    const d = deps()
    const result = await fetchRepoFileContent({ externalInstallationId: 42, path: '../secrets' }, d)
    expect(result).toEqual({ ok: false, reason: 'invalid_path' })
    expect(d.resolveRepo).not.toHaveBeenCalled()
    expect(d.getContent).not.toHaveBeenCalled()
  })

  it('not_found when the installation has no resolvable repository', async () => {
    const result = await fetchRepoFileContent(
      { externalInstallationId: 42, path: 'src/a.ts' },
      deps({ resolveRepo: vi.fn(async () => null) }),
    )
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('not_found when GitHub 404s or the path is a directory', async () => {
    expect(
      await fetchRepoFileContent(
        { externalInstallationId: 42, path: 'gone.ts' },
        deps({ getContent: vi.fn(async () => null) }),
      ),
    ).toEqual({ ok: false, reason: 'not_found' })
    expect(
      await fetchRepoFileContent(
        { externalInstallationId: 42, path: 'src' },
        deps({ getContent: vi.fn(async () => ({ type: 'dir' })) }),
      ),
    ).toEqual({ ok: false, reason: 'not_found' })
  })

  it('binary when the decoded content carries NUL bytes', async () => {
    const result = await fetchRepoFileContent(
      { externalInstallationId: 42, path: 'logo.png' },
      deps({
        getContent: vi.fn(async () => ({
          type: 'file',
          content: Buffer.from('\x89PNG\0\0binary').toString('base64'),
          encoding: 'base64',
          size: 12,
        })),
      }),
    )
    expect(result).toEqual({ ok: false, reason: 'binary' })
  })

  it('too_large when GitHub omits content for an oversized file', async () => {
    const result = await fetchRepoFileContent(
      { externalInstallationId: 42, path: 'huge.json' },
      deps({ getContent: vi.fn(async () => ({ type: 'file', content: '', encoding: 'none', size: 5_000_000 })) }),
    )
    expect(result).toEqual({ ok: false, reason: 'too_large' })
  })

  it('truncates text beyond 500KB and flags it', async () => {
    const big = 'a'.repeat(500_001)
    const result = await fetchRepoFileContent(
      { externalInstallationId: 42, path: 'big.txt' },
      deps({
        getContent: vi.fn(async () => ({
          type: 'file',
          content: Buffer.from(big).toString('base64'),
          encoding: 'base64',
          size: big.length,
        })),
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.truncated).toBe(true)
      expect(result.text.length).toBe(500_000)
    }
  })

  it('fails soft to unavailable on any unexpected error (never throws)', async () => {
    const result = await fetchRepoFileContent(
      { externalInstallationId: 42, path: 'src/a.ts' },
      deps({ getContent: vi.fn(async () => Promise.reject(new Error('GitHub 500'))) }),
    )
    expect(result).toEqual({ ok: false, reason: 'unavailable' })
  })
})
