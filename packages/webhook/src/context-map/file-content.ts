// Live source-file fetch for the dashboard's code map "read the code" panel.
//
// Content comes from GitHub's Contents API using the App INSTALLATION token —
// the exact identity + getContent pattern already proven in pr-fetcher.ts — so
// the reader always sees the current default-branch file, scoped by GitHub to
// that installation's repos only. Nothing is persisted.
//
// Tenancy: the caller (the dashboard's session-authenticated /api/code-map/file
// route) resolves the external installation id from the session BEFORE calling
// the internal endpoint; this module additionally validates the repo path so a
// crafted path can never probe outside the repo tree.

export type FileContentResult =
  | { ok: true; path: string; text: string; truncated: boolean }
  | { ok: false; reason: 'invalid_path' | 'not_found' | 'binary' | 'too_large' | 'unavailable' }

/** Max text returned to the panel; longer files are cut and flagged. */
const MAX_TEXT_CHARS = 500_000
/** How much of the decoded head we scan for NUL bytes (binary sniff). */
const BINARY_SNIFF_CHARS = 8_192

export interface FileContentDeps {
  /** externalInstallationId -> { owner, repo }, or null when unresolvable. */
  resolveRepo(externalInstallationId: number): Promise<{ owner: string; repo: string } | null>
  /** GitHub contents fetch; null on 404, throws on other failures. */
  getContent(args: { externalInstallationId: number; owner: string; repo: string; path: string }): Promise<{
    type: string
    content?: string
    encoding?: string
    size?: number
  } | null>
}

/**
 * A path is safe iff it is repo-relative and can only ever name something
 * inside the repo tree: no absolute/drive prefixes, no backslashes, no NUL,
 * no `..` traversal, no empty segments.
 */
export function isSafeRepoPath(path: string): boolean {
  if (!path || path.includes('\0') || path.includes('\\')) return false
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  const segments = path.split('/')
  return segments.every((s) => s !== '' && s !== '..')
}

export async function fetchRepoFileContent(
  args: { externalInstallationId: number; path: string },
  deps: FileContentDeps = defaultFileContentDeps(),
): Promise<FileContentResult> {
  if (!isSafeRepoPath(args.path)) return { ok: false, reason: 'invalid_path' }

  try {
    const repo = await deps.resolveRepo(args.externalInstallationId)
    if (!repo) return { ok: false, reason: 'not_found' }

    const file = await deps.getContent({
      externalInstallationId: args.externalInstallationId,
      owner: repo.owner,
      repo: repo.repo,
      path: args.path,
    })
    if (!file || file.type !== 'file') return { ok: false, reason: 'not_found' }

    // GitHub omits inline content (encoding "none") for files over ~1MB.
    if (!file.content) return { ok: false, reason: 'too_large' }

    const text = Buffer.from(file.content, (file.encoding as BufferEncoding) || 'base64').toString('utf8')
    if (text.slice(0, BINARY_SNIFF_CHARS).includes('\0')) return { ok: false, reason: 'binary' }

    const truncated = text.length > MAX_TEXT_CHARS
    return { ok: true, path: args.path, text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated }
  } catch (err) {
    // Fail soft: a GitHub hiccup renders an honest "unavailable" panel state,
    // never a 500 out of the map.
    console.error('[context-map] file content fetch failed', err)
    return { ok: false, reason: 'unavailable' }
  }
}

/** Default deps: Prisma repo lookup + installation-token getContent (pr-fetcher pattern). */
export function defaultFileContentDeps(): FileContentDeps {
  return {
    resolveRepo: async (externalInstallationId) => {
      const { prisma } = await import('../db.js')
      const installation = await prisma.installation.findUnique({
        where: { provider_externalId: { provider: 'github', externalId: externalInstallationId } },
        select: { id: true },
      })
      if (!installation) return null
      const repository = await prisma.repository.findFirst({
        where: { installationId: installation.id },
        orderBy: { createdAt: 'desc' },
        select: { fullName: true },
      })
      const [owner, repo] = repository?.fullName.split('/') ?? []
      return owner && repo ? { owner, repo } : null
    },
    getContent: async ({ externalInstallationId, owner, repo, path }) => {
      const { createApp, getInstallationOctokit } = await import('../github-auth.js')
      const octokit = await getInstallationOctokit(createApp(), externalInstallationId)
      try {
        const res = await (octokit as unknown as {
          rest: { repos: { getContent(a: object): Promise<{ data: { type: string; content?: string; encoding?: string; size?: number } }> } }
        }).rest.repos.getContent({ owner, repo, path })
        return res.data
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null
        throw err
      }
    },
  }
}
