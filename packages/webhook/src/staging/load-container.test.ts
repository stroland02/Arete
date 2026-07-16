import { describe, it, expect, vi } from 'vitest'
import { loadApprovedContainer, type LoadContainerDeps } from './load-container.js'

function fakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cont_abc',
    installationId: 'inst_uuid_1',
    state: 'approved',
    gates: { solutionApprovedAt: '2026-07-16T10:00:00.000Z' },
    target: { owner: 'acme', repo: 'web' },
    pr: { base: 'main', title: 'Fix the bug', body: 'body text' },
    patch: [{ path: 'src/a.ts', contents: 'new' }],
    findings: [{ id: 'f1' }],
    createdAt: new Date('2026-07-16T09:00:00.000Z'),
    updatedAt: new Date('2026-07-16T10:00:00.000Z'),
    ...overrides,
  }
}

function fakeDeps(row: unknown) {
  const findFirst = vi.fn().mockResolvedValue(row)
  const deps: LoadContainerDeps = { prisma: { issueContainer: { findFirst } } }
  return { deps, findFirst }
}

describe('loadApprovedContainer', () => {
  it('reads the container scoped by BOTH id and installationId (a foreign tenant can never match)', async () => {
    const { deps, findFirst } = fakeDeps(fakeRow())

    await loadApprovedContainer('cont_abc', 'inst_uuid_1', deps)

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'cont_abc', installationId: 'inst_uuid_1' },
    })
  })

  it('maps the row to an ApprovedContainer, parsing solutionApprovedAt to a Date', async () => {
    const { deps } = fakeDeps(fakeRow())

    const container = await loadApprovedContainer('cont_abc', 'inst_uuid_1', deps)

    expect(container).toEqual({
      id: 'cont_abc',
      installationId: 'inst_uuid_1',
      target: { owner: 'acme', repo: 'web' },
      pr: { base: 'main', title: 'Fix the bug', body: 'body text' },
      patch: [{ path: 'src/a.ts', contents: 'new' }],
      gates: { solutionApprovedAt: new Date('2026-07-16T10:00:00.000Z') },
    })
  })

  it('returns null when no container matches the tenant scope (→ not_found → 404)', async () => {
    const { deps } = fakeDeps(null)
    expect(await loadApprovedContainer('missing', 'inst_uuid_1', deps)).toBeNull()
  })

  it('does NOT gate-filter: an un-approved container still loads (the gate is enforced downstream as 409, not 404)', async () => {
    const { deps } = fakeDeps(fakeRow({ state: 'open', gates: { solutionApprovedAt: null } }))

    const container = await loadApprovedContainer('cont_abc', 'inst_uuid_1', deps)

    expect(container).not.toBeNull()
    expect(container!.gates.solutionApprovedAt).toBeNull()
  })
})
