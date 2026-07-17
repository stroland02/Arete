import { describe, it, expect, vi } from 'vitest'
import { stagePullRequest, type ApprovedContainer, type StagingOctokit } from './stage-pr.js'

// PR staging = the send gate (spec §4 step 8). Given an APPROVED IssueContainer,
// compose a branch + patch and open the PR via the GitHub App. It must:
//  • never send unless gates.solutionApprovedAt is set (no auto-send),
//  • be idempotent per container (deterministic head branch arete/fix/<id> +
//    a pre-open lookup) so a replay/double-post never opens a second PR,
//  • target exactly container.target.owner/repo (no cross-repo/tenant bleed).
// Driven end-to-end here against a fake Octokit — no network, no GitHub App.

const APPROVED: ApprovedContainer = {
  id: 'cont_abc',
  installationId: 'inst_1',
  target: { owner: 'acme', repo: 'web' },
  pr: { base: 'main', title: 'Fix null deref in checkout', body: 'Closes the crash.' },
  patch: [{ path: 'src/checkout.ts', content: 'export const x = 1\n' }],
  gates: { solutionApprovedAt: new Date('2026-07-16T00:00:00Z') },
}

function fakeOctokit() {
  const list = vi.fn().mockResolvedValue({ data: [] as Array<{ number: number; html_url: string }> })
  const create = vi
    .fn()
    .mockResolvedValue({ data: { number: 42, html_url: 'https://github.com/acme/web/pull/42' } })
  const getRef = vi.fn().mockResolvedValue({ data: { object: { sha: 'base-sha' } } })
  const createTree = vi.fn().mockResolvedValue({ data: { sha: 'tree-sha' } })
  const createCommit = vi.fn().mockResolvedValue({ data: { sha: 'commit-sha' } })
  const createRef = vi.fn().mockResolvedValue({ data: {} })
  const updateRef = vi.fn().mockResolvedValue({ data: {} })
  const octokit = {
    rest: {
      git: { getRef, createTree, createCommit, createRef, updateRef },
      pulls: { list, create },
    },
  }
  return {
    octokit: octokit as unknown as StagingOctokit,
    spies: { list, create, getRef, createTree, createCommit, createRef, updateRef },
  }
}

describe('stagePullRequest', () => {
  it('refuses to send when the container is NOT solution-approved (no auto-send)', async () => {
    const { octokit, spies } = fakeOctokit()
    const unapproved: ApprovedContainer = {
      ...APPROVED,
      gates: { solutionApprovedAt: null },
    }

    const result = await stagePullRequest(octokit, unapproved)

    expect(result).toEqual({ outcome: 'not_approved' })
    // The gate is server-side: NOTHING touches the repo.
    expect(spies.create).not.toHaveBeenCalled()
    expect(spies.createRef).not.toHaveBeenCalled()
    expect(spies.createCommit).not.toHaveBeenCalled()
  })

  it('opens a PR from a deterministic branch, committing the patch to the target repo', async () => {
    const { octokit, spies } = fakeOctokit()

    const result = await stagePullRequest(octokit, APPROVED)

    // Commit the patch onto a fresh tree based on main's tip.
    expect(spies.getRef).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'web', ref: 'heads/main' }),
    )
    expect(spies.createTree).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'web',
        base_tree: 'base-sha',
        tree: [{ path: 'src/checkout.ts', mode: '100644', type: 'blob', content: 'export const x = 1\n' }],
      }),
    )
    // Deterministic head branch derived from the container id.
    expect(spies.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'web', ref: 'refs/heads/arete/fix/cont_abc', sha: 'commit-sha' }),
    )
    // Open the PR: main <- arete/fix/cont_abc, with the composed title/body.
    expect(spies.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'web',
        base: 'main',
        head: 'arete/fix/cont_abc',
        title: 'Fix null deref in checkout',
        body: 'Closes the crash.',
      }),
    )
    expect(result).toEqual({
      outcome: 'opened',
      number: 42,
      hostUrl: 'https://github.com/acme/web/pull/42',
    })
  })

  it('is idempotent per container: an existing PR for the head branch is returned, not re-opened', async () => {
    const { octokit, spies } = fakeOctokit()
    spies.list.mockResolvedValueOnce({
      data: [{ number: 7, html_url: 'https://github.com/acme/web/pull/7' }],
    })

    const result = await stagePullRequest(octokit, APPROVED)

    expect(result).toEqual({
      outcome: 'already_open',
      number: 7,
      hostUrl: 'https://github.com/acme/web/pull/7',
    })
    // No second PR, no new branch — a double Post is a no-op.
    expect(spies.create).not.toHaveBeenCalled()
    expect(spies.createRef).not.toHaveBeenCalled()
  })

  it('recovers when the branch already exists from a prior partial run (updates ref, opens PR)', async () => {
    const { octokit, spies } = fakeOctokit()
    // No PR yet, but the branch ref survived a crash between createRef and pulls.create.
    spies.createRef.mockRejectedValueOnce(
      Object.assign(new Error('Reference already exists'), { status: 422 }),
    )

    const result = await stagePullRequest(octokit, APPROVED)

    // Force the surviving branch to the freshly composed commit, then open the PR.
    expect(spies.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'web', ref: 'heads/arete/fix/cont_abc', sha: 'commit-sha', force: true }),
    )
    expect(spies.create).toHaveBeenCalledTimes(1)
    expect(result.outcome).toBe('opened')
  })
})
