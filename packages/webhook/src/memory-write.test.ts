import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

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

// Warm vite's transform cache before any test is timed — same fix, and same
// reasoning, as tenancy.test.ts. loadModule() must run inside each test (it
// installs a per-test ./db.js mock), and its FIRST call pays the cold transform
// of memory-write.js and its dependency chain: 1425ms in isolation, 3421ms in
// the full suite under CPU contention. Later calls are nearly free, because
// vi.resetModules() clears the module registry, not vite's transform cache.
//
// Charged to the first test that left ~1.6s under vitest's 5s testTimeout, which
// is the same landmine tenancy.test.ts stepped on — just further from going off.
// Paying it in beforeAll charges setup work to setup (hookTimeout, 10s) and
// leaves each test measuring only its own behaviour.
beforeAll(async () => {
  await loadModule(makeFakeStore({}))
  vi.resetModules()
})

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

  // REDACTION mutation test (finding B1, Global Constraint 2). AgentMemory
  // rows are a PERSISTENCE SINK that is re-sent to the model provider on
  // every later review of the repo (fetchProjectMemories -> base.py's prompt),
  // so an unscrubbed secret here is amplified, not merely stored. Both
  // model-authored free-text columns must go through the SAME canonical
  // @arete/telemetry sink scrubber the alerting sink uses (receiver.ts:46) —
  // a review probe stored `sk-ant-api03-…` byte-for-byte in both.
  it('scrubs secret-shaped substrings out of body before persisting', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(
      baseParams({
        title: 'Deploy note',
        body: 'Deploy key is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA and the callback is https://x.dev/cb?token=abc123',
      })
    )

    expect(result).toMatchObject({ ok: true })
    const stored = store.memories[0].body
    expect(stored).not.toContain('sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA')
    expect(stored).not.toContain('abc123')
    expect(stored).toContain('[REDACTED]')
  })

  it('scrubs secret-shaped substrings out of title before persisting', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(
      baseParams({ title: 'use ghp_AAAAAAAAAAAAAAAAAAAA for CI', body: 'irrelevant' })
    )

    expect(result).toMatchObject({ ok: true })
    expect(store.memories[0].title).not.toContain('ghp_AAAAAAAAAAAAAAAAAAAA')
    expect(store.memories[0].title).toContain('[REDACTED]')
  })

  it('scrubs the title even when it is derived from the body', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory } = await loadModule(store)

    await saveAgentMemory(
      baseParams({ title: undefined, body: 'ghp_BBBBBBBBBBBBBBBBBBBB is the CI token' })
    )

    expect(store.memories[0].title).not.toContain('ghp_BBBBBBBBBBBBBBBBBBBB')
  })

  // SIZE-CAP mutation test (finding B2). The cap existed on `body` only, so an
  // 80,000-char `title` returned 201 over real HTTP and stored all 80,000. The
  // Python tool truncates title client-side — exactly the client-side-only
  // bound this task exists to remove.
  it('rejects an oversized title -- not truncated, not persisted', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory, MAX_MEMORY_TITLE_CHARS } = await loadModule(store)

    const result = await saveAgentMemory(baseParams({ title: 'x'.repeat(80_000) }))

    expect(result).toMatchObject({ ok: false, reason: 'title_too_long' })
    expect(store.agentMemory.create).not.toHaveBeenCalled()
    expect(store.memories).toHaveLength(0)
    expect(MAX_MEMORY_TITLE_CHARS).toBeLessThan(80_000)
  })

  // Cap-on-stored-value mutation test (finding N2). The caps used to be
  // measured on the RAW input, but redaction can LENGTHEN a string
  // (`?token=a` -> `?token=[REDACTED]`, 8 chars -> 17). A reviewer probe
  // built a 3,996-char raw body entirely of `?token=a` fragments -- under
  // the (old) raw-length cap -- and it was accepted and stored at 7,992
  // chars, ~2x the documented bound. AgentMemory rows are re-injected into
  // EVERY future review prompt for the repo (fetchProjectMemories -> base.py),
  // so the invariant worth enforcing is the size of what actually gets
  // persisted and re-sent to the model, not the size of what the caller
  // happened to type.
  it('rejects a body whose post-redaction length exceeds the cap, even though the raw input is within it', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory, MAX_MEMORY_BODY_CHARS } = await loadModule(store)

    const unit = '?token=a ' // 9 raw chars; scrubs to '?token=[REDACTED] ' (18 chars)
    const body = unit.repeat(444) // 444 * 9 = 3,996 raw chars -- the reviewer's exact probe
    expect(body.length).toBe(3996)
    expect(body.length).toBeLessThanOrEqual(MAX_MEMORY_BODY_CHARS)

    const result = await saveAgentMemory(baseParams({ body }))

    expect(result).toMatchObject({ ok: false, reason: 'body_too_long' })
    expect(store.agentMemory.create).not.toHaveBeenCalled()
    expect(store.memories).toHaveLength(0)
  })

  it('rejects a title whose post-redaction length exceeds the cap, even though the raw input is within it', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory, MAX_MEMORY_TITLE_CHARS } = await loadModule(store)

    const unit = '?token=a ' // 9 raw chars; scrubs to '?token=[REDACTED] ' (18 chars)
    const title = unit.repeat(22) // 22 * 9 = 198 raw chars -- mirrors the reviewer's 198-char title probe
    expect(title.length).toBe(198)
    expect(title.length).toBeLessThanOrEqual(MAX_MEMORY_TITLE_CHARS)

    const result = await saveAgentMemory(baseParams({ title }))

    expect(result).toMatchObject({ ok: false, reason: 'title_too_long' })
    expect(store.agentMemory.create).not.toHaveBeenCalled()
    expect(store.memories).toHaveLength(0)
  })

  // Positive counterpart: the SAME redaction that lengthens the token-shaped
  // body above can also SHORTEN one (`stripUrlQuery` drops the whole query
  // string) -- confirming the cap tracks the stored value in both
  // directions, not just catching the lengthening case.
  it('accepts a body that redaction shortens under the cap even though a naive doubled-length estimate would not', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory, MAX_MEMORY_BODY_CHARS } = await loadModule(store)

    const longQuery = 'x'.repeat(MAX_MEMORY_BODY_CHARS - 20)
    const body = `see https://example.com/a?password=${longQuery} for details`
    const result = await saveAgentMemory(baseParams({ body }))

    expect(result).toMatchObject({ ok: true })
    expect(store.memories[0].body.length).toBeLessThanOrEqual(MAX_MEMORY_BODY_CHARS)
  })

  it('accepts a title exactly at the cap (boundary)', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory, MAX_MEMORY_TITLE_CHARS } = await loadModule(store)

    const result = await saveAgentMemory(baseParams({ title: 'x'.repeat(MAX_MEMORY_TITLE_CHARS) }))

    expect(result).toMatchObject({ ok: true })
  })

  // Ordering (minor finding): `body.slice(0, 80)` ran BEFORE the
  // `typeof body !== 'string'` check, so a non-string body threw and reported
  // internal_error (500) instead of invalid_input (400).
  it('reports a non-string body as invalid_input, not internal_error', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory } = await loadModule(store)

    // `title` omitted on purpose: the inverted line is `body.slice(0, 80)` in
    // the title fallback, which a supplied title short-circuits past.
    const result = await saveAgentMemory(
      baseParams({ title: undefined, body: { nope: true } as unknown as string })
    )

    expect(result).toEqual({ ok: false, reason: 'invalid_input' })
    expect(store.agentMemory.create).not.toHaveBeenCalled()
  })

  it('reports a non-string title as invalid_input, not internal_error', async () => {
    const store = makeFakeStore({ installations: [INST_A], repositories: [REPO_A] })
    const { saveAgentMemory } = await loadModule(store)

    const result = await saveAgentMemory(baseParams({ title: 42 as unknown as string }))

    expect(result).toEqual({ ok: false, reason: 'invalid_input' })
    expect(store.agentMemory.create).not.toHaveBeenCalled()
  })
})
