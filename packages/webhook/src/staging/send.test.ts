import { describe, it, expect, vi } from 'vitest'
import { runStagingSend, type StagingSendDeps } from './send.js'
import type { ApprovedContainer, StagingOctokit } from './stage-pr.js'

// The production caller around the tested stagePullRequest core (send gate,
// spec §4 step 8). The dashboard POSTs { containerId, installationId } (both
// internal uuids); this resolves installationId -> Installation.externalId ->
// an installation Octokit, loads the approved container slice, and runs the
// gate-enforced/idempotent core. It returns a flat outcome the dashboard action
// switches on: opened | already_open | not_approved | failed.
//
// Driven end-to-end here with fakes — no @arete/db, no GitHub App. We use the
// REAL stagePullRequest against a fake Octokit so send+stage are exercised
// together, exactly as production runs them.

const APPROVED: ApprovedContainer = {
  id: 'cont_abc',
  installationId: 'inst_uuid_1',
  target: { owner: 'acme', repo: 'web' },
  pr: { base: 'main', title: 'Fix null deref in checkout', body: 'Closes the crash.' },
  patch: [{ path: 'src/checkout.ts', content: 'export const x = 1\n' }],
  gates: { solutionApprovedAt: new Date('2026-07-16T00:00:00Z') },
}

function fakeOctokit(overrides: { existingPr?: { number: number; html_url: string } } = {}) {
  const list = vi
    .fn()
    .mockResolvedValue({ data: overrides.existingPr ? [overrides.existingPr] : [] })
  const create = vi
    .fn()
    .mockResolvedValue({ data: { number: 42, html_url: 'https://github.com/acme/web/pull/42' } })
  const getRef = vi.fn().mockResolvedValue({ data: { object: { sha: 'base-sha' } } })
  const createTree = vi.fn().mockResolvedValue({ data: { sha: 'tree-sha' } })
  const createCommit = vi.fn().mockResolvedValue({ data: { sha: 'commit-sha' } })
  const createRef = vi.fn().mockResolvedValue({ data: {} })
  const updateRef = vi.fn().mockResolvedValue({ data: {} })
  const octokit = {
    rest: { git: { getRef, createTree, createCommit, createRef, updateRef }, pulls: { list, create } },
  }
  return { octokit: octokit as unknown as StagingOctokit, spies: { list, create } }
}

function fakeDeps(
  container: ApprovedContainer | null,
  octokit: StagingOctokit,
  externalId: number | null = 987654,
): { deps: StagingSendDeps; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const resolveExternalId = vi.fn().mockResolvedValue(externalId)
  const getOctokit = vi.fn().mockResolvedValue(octokit)
  const loadContainer = vi.fn().mockResolvedValue(container)
  return {
    deps: { resolveExternalId, getOctokit, loadContainer },
    spies: { resolveExternalId, getOctokit, loadContainer },
  }
}

describe('runStagingSend', () => {
  it('resolves the installation, loads the container, and opens the PR', async () => {
    const { octokit, spies: gh } = fakeOctokit()
    const { deps, spies } = fakeDeps(APPROVED, octokit)

    const result = await runStagingSend(deps, { containerId: 'cont_abc', installationId: 'inst_uuid_1' })

    // uuid -> Installation.externalId -> getInstallationOctokit(externalId)
    expect(spies.resolveExternalId).toHaveBeenCalledWith('inst_uuid_1')
    expect(spies.getOctokit).toHaveBeenCalledWith(987654)
    // container is loaded scoped to the tenant, never by id alone
    expect(spies.loadContainer).toHaveBeenCalledWith('cont_abc', 'inst_uuid_1')
    expect(gh.create).toHaveBeenCalledTimes(1)
    // stage-pr's { number, hostUrl } is flattened to { prNumber, prUrl }
    expect(result).toEqual({
      outcome: 'opened',
      prNumber: 42,
      prUrl: 'https://github.com/acme/web/pull/42',
    })
  })

  it('passes through already_open when the PR already exists (idempotent replay)', async () => {
    const { octokit, spies: gh } = fakeOctokit({
      existingPr: { number: 7, html_url: 'https://github.com/acme/web/pull/7' },
    })
    const { deps } = fakeDeps(APPROVED, octokit)

    const result = await runStagingSend(deps, { containerId: 'cont_abc', installationId: 'inst_uuid_1' })

    expect(gh.create).not.toHaveBeenCalled()
    expect(result).toEqual({
      outcome: 'already_open',
      prNumber: 7,
      prUrl: 'https://github.com/acme/web/pull/7',
    })
  })

  it('returns not_approved (no send) when the container has no solution approval', async () => {
    const { octokit, spies: gh } = fakeOctokit()
    const unapproved: ApprovedContainer = { ...APPROVED, gates: { solutionApprovedAt: null } }
    const { deps } = fakeDeps(unapproved, octokit)

    const result = await runStagingSend(deps, { containerId: 'cont_abc', installationId: 'inst_uuid_1' })

    expect(result).toEqual({ outcome: 'not_approved' })
    expect(gh.create).not.toHaveBeenCalled()
  })

  it('fails (never sends) when the installation cannot be resolved', async () => {
    const { octokit, spies: gh } = fakeOctokit()
    const { deps, spies } = fakeDeps(APPROVED, octokit, null)

    const result = await runStagingSend(deps, { containerId: 'cont_abc', installationId: 'ghost' })

    expect(result.outcome).toBe('failed')
    if (result.outcome === 'failed') expect(result.detail).toMatch(/installation/i)
    // short-circuit: we never load a container or touch GitHub for a phantom tenant
    expect(spies.loadContainer).not.toHaveBeenCalled()
    expect(gh.create).not.toHaveBeenCalled()
  })

  it('fails when the container does not exist for this tenant', async () => {
    const { octokit, spies: gh } = fakeOctokit()
    const { deps } = fakeDeps(null, octokit)

    const result = await runStagingSend(deps, { containerId: 'missing', installationId: 'inst_uuid_1' })

    expect(result.outcome).toBe('failed')
    if (result.outcome === 'failed') expect(result.detail).toMatch(/container/i)
    expect(gh.create).not.toHaveBeenCalled()
  })

  // Adversarial cross-tenant guard (same rigor as the store isolation test): a
  // loader that returns a container belonging to a DIFFERENT tenant than the
  // caller claimed must be refused — never opened — even though the container
  // is itself solution-approved. Defense in depth behind loadContainer's scoping.
  it('refuses a container whose installationId does not match the caller (no cross-tenant send)', async () => {
    const { octokit, spies: gh } = fakeOctokit()
    const foreign: ApprovedContainer = { ...APPROVED, installationId: 'inst_uuid_OTHER' }
    const { deps } = fakeDeps(foreign, octokit)

    const result = await runStagingSend(deps, { containerId: 'cont_abc', installationId: 'inst_uuid_1' })

    expect(result.outcome).toBe('failed')
    if (result.outcome === 'failed') expect(result.detail).toMatch(/tenant/i)
    expect(gh.create).not.toHaveBeenCalled()
  })

  it('fails (does not throw) when the GitHub call errors', async () => {
    const { octokit, spies: gh } = fakeOctokit()
    gh.create.mockRejectedValueOnce(Object.assign(new Error('502 upstream'), { status: 502 }))
    const { deps } = fakeDeps(APPROVED, octokit)

    const result = await runStagingSend(deps, { containerId: 'cont_abc', installationId: 'inst_uuid_1' })

    expect(result.outcome).toBe('failed')
    if (result.outcome === 'failed') expect(result.detail).toContain('502')
  })
})
