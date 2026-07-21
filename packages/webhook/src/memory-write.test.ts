import { describe, it, expect, vi, beforeEach } from 'vitest'

// saveAgentMemory is the pure business-logic core behind POST
// /internal/memory (route wiring + the auth-rejection mutation test live in
// server.test.ts, matching the split already used for /alerts/incoming and
// /fix/trigger). These tests drive it against a fake prisma store that mimics
// the real Installation/Repository/AgentMemory relations so the tenant guard,
// size caps, and honest-failure behavior can be asserted without a real
// Postgres.

interface FakeMemoryRow {
  id: string
  repositoryId: string
  kind: string
  title: string
  body: string
  status: string
}

function makeFakeStore(opts: {
  installations?: Array<{ id: string; externalId: number }>
  repositories?: Array<{ id: string; installationId: string; fullName: string }>
  existingMemories?: FakeMemoryRow[]
  createShouldThrow?: boolean
} = {}) {
  const installations = opts.installations ?? []
  const repositories = opts.repositories ?? []
  const memories: FakeMemoryRow[] = [...(opts.existingMemories ?? [])]
  let seq = memories.length

  const installation = {
    findUnique: vi.fn(async (args: any) => {
      const { externalId } = args.where.provider_externalId
      return installations.find((i) => i.externalId === externalId) ?? null
    }),
  }
  const repository = {
    findFirst: vi.fn(async (args: any) => {
      const { installationId, fullName } = args.where
      return (
        repositories.find((r) => r.installationId === installationId && r.fullName === fullName) ?? null
      )
    }),
  }
  const agentMemory = {
    count: vi.fn(async (args: any) => {
      const { repositoryId, status } = args.where
      return memories.filter((m) => m.repositoryId === repositoryId && m.status === status).length
    }),
    create: vi.fn(async (args: any) => {
      if (opts.createShouldThrow) {
        throw new Error('connection terminated unexpectedly')
      }
      seq += 1
      const row: FakeMemoryRow = { id: `mem-${seq}`, status: 'active', ...args.data }
      memories.push(row)
      return { id: row.id }
    }),
  }
  return { installation, repository, agentMemory, memories }
}

async function loadModule(store: ReturnType<typeof makeFakeStore>) {
  vi.doMock('./db.js', () => ({ prisma: { installation: store.installation, repository: store.repository, agentMemory: store.agentMemory } }))
  return import('./memory-write.js')
}

const INST_A = { id: 'inst-a-uuid', externalId: 111 }
const INST_B = { id: 'inst-b-uuid', externalId: 222 }
const REPO_A = { id: 'repo-a-uuid', installationId: INST_A.id, fullName: 'owner/repo-a' }
const REPO_B = { id: 'repo-b-uuid', installationId: INST_B.id, fullName: 'owner/repo-b' }

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    installationExternalId: INST_A.externalId,
    repoFullName: REPO_A.fullName,
    kind: 'terminology',
    title: 'Naming rule',
    body: 'Use tabs, not spaces.',
    ...overrides,
  }
}

describe('saveAgentMemory', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('actually persists a row for a valid same-tenant write', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(baseParams())

    expect(result).toMatchObject({ ok: true })
    expect(store.agentMemory.create).toHaveBeenCalledTimes(1)
    expect(store.memories).toHaveLength(1)
    expect(store.memories[0]).toMatchObject({
      repositoryId: REPO_A.id,
      kind: 'terminology',
      title: 'Naming rule',
      body: 'Use tabs, not spaces.',
    })
  })

  // SECURITY mutation test (Global Constraint 10): a memory must be
  // impossible to write to another tenant's repository. installation A calls
  // with repo B's full name -- repo B only resolves under installation B's
  // id, so the lookup scoped to installation A's id must come back empty and
  // nothing may be written.
  it('rejects a write to a repository outside the caller installation and persists nothing', async () => {
    const store = makeFakeStore({ installations: [INST_A, INST_B], repositories: [REPO_A, REPO_B] })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(
      baseParams({ installationExternalId: INST_A.externalId, repoFullName: REPO_B.fullName })
    )

    expect(result).toEqual({ ok: false, reason: 'repo_not_found' })
    expect(store.agentMemory.create).not.toHaveBeenCalled()
    expect(store.memories).toHaveLength(0)
  })

  it('rejects a write to a repository that does not exist at all, identically to a cross-tenant one', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(baseParams({ repoFullName: 'owner/does-not-exist' }))

    expect(result).toEqual({ ok: false, reason: 'repo_not_found' })
    expect(store.agentMemory.create).not.toHaveBeenCalled()
  })

  it('rejects an oversized body -- not truncated, not persisted', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory, MAX_MEMORY_BODY_CHARS } = await loadModule(store)

    const oversized = 'x'.repeat(MAX_MEMORY_BODY_CHARS + 1)
    const result = await saveAgentMemory(baseParams({ body: oversized }))

    expect(result).toMatchObject({ ok: false, reason: 'body_too_long' })
    expect(store.agentMemory.create).not.toHaveBeenCalled()
    expect(store.memories).toHaveLength(0)
  })

  it('accepts a body exactly at the cap (boundary)', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory, MAX_MEMORY_BODY_CHARS } = await loadModule(store)

    const atCap = 'x'.repeat(MAX_MEMORY_BODY_CHARS)
    const result = await saveAgentMemory(baseParams({ body: atCap }))

    expect(result).toMatchObject({ ok: true })
  })

  it('rejects once the repository is at its active-memory row cap', async () => {
    // Hardcoded (not imported mid-test): a separate import of memory-write.js
    // before loadModule()'s vi.doMock resolves against the real (unmocked)
    // db.js and would bind saveAgentMemory to a different module instance
    // than the fake store below. Mirrors memory-write.ts's exported
    // MAX_MEMORIES_PER_REPO (== persistence.ts's MAX_PROJECT_MEMORIES).
    const MAX_MEMORIES_PER_REPO = 20
    const existingMemories = Array.from({ length: MAX_MEMORIES_PER_REPO }, (_, i) => ({
      id: `existing-${i}`,
      repositoryId: REPO_A.id,
      kind: 'project',
      title: `t${i}`,
      body: `b${i}`,
      status: 'active',
    }))
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A], existingMemories })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(baseParams())

    expect(result).toMatchObject({ ok: false, reason: 'cap_exceeded' })
    expect(store.agentMemory.create).not.toHaveBeenCalled()
    expect(store.memories).toHaveLength(MAX_MEMORIES_PER_REPO)
  })

  it('does not count archived rows against the active cap', async () => {
    const MAX_MEMORIES_PER_REPO = 20 // mirrors memory-write.ts's exported constant (== persistence.ts's MAX_PROJECT_MEMORIES)
    const existingMemories = Array.from({ length: MAX_MEMORIES_PER_REPO }, (_, i) => ({
      id: `archived-${i}`,
      repositoryId: REPO_A.id,
      kind: 'project',
      title: `t${i}`,
      body: `b${i}`,
      status: 'archived',
    }))
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A], existingMemories })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(baseParams())

    expect(result).toMatchObject({ ok: true })
  })

  // Honest-failure test (the stub's core defect, mirrored on the TS side): a
  // genuine DB rejection on the write itself must come back as
  // { ok: false }, never a fabricated success.
  it('returns an honest failure, never a fabricated success, when the persistence write itself fails', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A], createShouldThrow: true })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(baseParams())

    expect(result).toEqual({ ok: false, reason: 'internal_error' })
    expect(store.memories).toHaveLength(0)
  })

  it('rejects invalid input (empty body) without ever reaching the DB', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(baseParams({ body: '   ' }))

    expect(result).toEqual({ ok: false, reason: 'invalid_input' })
    expect(store.installation.findUnique).not.toHaveBeenCalled()
  })

  it('falls back an unrecognized kind to "project" rather than rejecting', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(baseParams({ kind: 'not-a-real-kind' }))

    expect(result).toMatchObject({ ok: true })
    expect(store.memories[0].kind).toBe('project')
  })
})
