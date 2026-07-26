// PR staging — the send gate of the Issue Container pipeline (see
// docs/superpowers/specs/2026-07-13-issue-container-and-pr-pipeline.md §4 step 8).
//
// Given an APPROVED IssueContainer, compose a branch + patch and open the PR via
// the GitHub App. Three guarantees, enforced here (server-side), not in the UI:
//
//  • No auto-send. `gates.solutionApprovedAt` MUST be set (the Agents-page
//    technical sign-off) before anything reaches the repo.
//  • Idempotent per container. The head branch is deterministic —
//    `arete/fix/<containerId>` — and we look for an existing PR on it before
//    opening one, so a double Post / retry returns the same PR instead of a
//    second. GitHub is the source of truth; no local dedupe table needed.
//  • Tenant/target-scoped. Every call targets exactly `container.target`
//    (owner/repo); the Octokit is already authed for the installation by the
//    caller (getInstallationOctokit), so it can only act on that tenant's repos.
//
// The Octokit surface is narrowed to `StagingOctokit` so this is driven
// end-to-end in tests with a fake — no network, no GitHub App private key.

/** A single composed file in the patch: its path and full new content. */
export interface StagedPatchFile {
  path: string
  content: string
}

/** The minimal slice of an approved IssueContainer that staging needs. The full
 *  container lives in the issue-pipeline; only these fields drive the send. */
export interface ApprovedContainer {
  id: string
  installationId: string
  target: { owner: string; repo: string }
  pr: { base: string; title: string; body: string }
  patch: StagedPatchFile[]
  gates: { solutionApprovedAt: Date | null }
}

export type StagePrResult =
  | { outcome: 'not_approved' }
  | { outcome: 'already_open'; number: number; hostUrl: string }
  | { outcome: 'opened'; number: number; hostUrl: string }

/** The subset of the GitHub REST client staging touches. The real installation
 *  Octokit (from getInstallationOctokit) satisfies this shape via `.rest`. */
export interface StagingOctokit {
  rest: {
    git: {
      getRef(params: { owner: string; repo: string; ref: string }): Promise<{ data: { object: { sha: string } } }>
      createTree(params: {
        owner: string
        repo: string
        base_tree: string
        tree: Array<{ path: string; mode: string; type: string; content: string }>
      }): Promise<{ data: { sha: string } }>
      createCommit(params: {
        owner: string
        repo: string
        message: string
        tree: string
        parents: string[]
      }): Promise<{ data: { sha: string } }>
      createRef(params: { owner: string; repo: string; ref: string; sha: string }): Promise<{ data: unknown }>
      updateRef(params: { owner: string; repo: string; ref: string; sha: string; force: boolean }): Promise<{ data: unknown }>
    }
    pulls: {
      list(params: {
        owner: string
        repo: string
        head: string
        state: 'open' | 'closed' | 'all'
      }): Promise<{ data: Array<{ number: number; html_url: string }> }>
      create(params: {
        owner: string
        repo: string
        title: string
        head: string
        base: string
        body: string
      }): Promise<{ data: { number: number; html_url: string } }>
    }
  }
}

/** The deterministic head branch for a container — the anchor of idempotency. */
export function stagingBranchFor(containerId: string): string {
  return `arete/fix/${containerId}`
}

/** GitHub answers a create-ref for an existing branch with 422 "Reference
 *  already exists" — a benign collision when a prior run created the branch but
 *  crashed before opening the PR. */
function isRefAlreadyExists(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { status?: number }).status === 422 &&
    /already exists/i.test((err as { message?: string }).message ?? '')
  )
}

export async function stagePullRequest(
  octokit: StagingOctokit,
  container: ApprovedContainer,
): Promise<StagePrResult> {
  // Gate: no send without the Agents-page solution approval.
  if (!container.gates.solutionApprovedAt) {
    return { outcome: 'not_approved' }
  }

  const { owner, repo } = container.target
  const { base } = container.pr
  const head = stagingBranchFor(container.id)

  // Idempotency: if a PR already exists for this container's head branch, that
  // IS the answer — never open a second.
  const existing = await octokit.rest.pulls.list({ owner, repo, head: `${owner}:${head}`, state: 'all' })
  if (existing.data.length > 0) {
    const pr = existing.data[0]
    return { outcome: 'already_open', number: pr.number, hostUrl: pr.html_url }
  }

  // Compose the branch: a commit carrying the patch on top of base's tip.
  const baseRef = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${base}` })
  const baseSha = baseRef.data.object.sha

  const tree = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseSha,
    tree: container.patch.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  })

  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: container.pr.title,
    tree: tree.data.sha,
    parents: [baseSha],
  })

  try {
    await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${head}`, sha: commit.data.sha })
  } catch (err) {
    if (!isRefAlreadyExists(err)) throw err
    // Branch survived a prior partial run — point it at the freshly composed
    // commit so the PR reflects the current patch, then open the PR below.
    await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${head}`, sha: commit.data.sha, force: true })
  }

  const pr = await octokit.rest.pulls.create({
    owner,
    repo,
    title: container.pr.title,
    head,
    base,
    body: container.pr.body,
  })

  return { outcome: 'opened', number: pr.data.number, hostUrl: pr.data.html_url }
}
