import { describe, it, expect, vi } from 'vitest'
import { driveFix, type FixTriggerDeps, type FixResponseBody } from './trigger.js'

function baseDeps(
  overrides: Partial<FixTriggerDeps> = {},
  itemOverrides: Record<string, unknown> = {},
): {
  deps: FixTriggerDeps
  containerUpdates: { id: string; data: Record<string, unknown> }[]
  workItemUpdates: { id: string; data: Record<string, unknown> }[]
} {
  const containerUpdates: { id: string; data: Record<string, unknown> }[] = []
  const workItemUpdates: { id: string; data: Record<string, unknown> }[] = []
  // Mutable so the "idempotent terminate" tests can drive the same work item
  // twice through the same deps and observe the container settle into a
  // terminal state after the first call.
  let containerState = 'detecting'
  const deps: FixTriggerDeps = {
    prisma: {
      workItem: {
        findUnique: async () => ({
          id: 'wi-1',
          installationId: 'inst-uuid',
          containerId: 'cont-1',
          kind: 'issue',
          title: 'SQL from raw input',
          detail: 'reports() passes q into db.raw',
          dimension: 'security',
          confidence: 0.8,
          evidence: [{ path: 'app/api/reports.ts', line: 3 }],
          fixFailureCount: 0,
          ...itemOverrides,
        }),
        update: async (args: any) => {
          workItemUpdates.push({ id: args.where.id, data: args.data })
          return {}
        },
      },
      installation: { findUnique: async () => ({ id: 'inst-uuid', externalId: 4242 }) },
      repository: { findFirst: async () => ({ id: 'repo-1', fullName: 'acme/api' }) },
      issueContainer: {
        findUnique: async () => ({ id: 'cont-1', state: containerState }),
        update: async (args: any) => {
          containerUpdates.push({ id: args.where.id, data: args.data })
          if (typeof args.data.state === 'string') containerState = args.data.state
          return {}
        },
      },
    },
    resolveModel: async () => ({ provider: 'ollama', model: 'qwen2.5-coder', baseUrl: 'http://127.0.0.1:11434' }),
    mintToken: async () => 'ghs_token',
    // Scan-born work item: no incident opened it, so there is no runtime
    // context to fetch. That is the default here because it is the default in
    // production — these cases are about the drive, not about telemetry.
    collectSignals: async () => null,
    fetchFix: async () => ({ status: 'fixed', patch: [{ path: 'app/api/reports.ts', content: 'safe();' }] }),
    ...overrides,
  }
  return { deps, containerUpdates, workItemUpdates }
}

describe('driveFix', () => {
  it('a fixed run advances the container to ready with the patch, WorkItem stays fixing', async () => {
    const { deps, containerUpdates, workItemUpdates } = baseDeps()
    const res = await driveFix('wi-1', deps)

    expect(res).toEqual({ ok: true, status: 'fixed' })
    const ready = containerUpdates.find((u) => u.data.state === 'ready')
    expect(ready).toBeTruthy()
    expect(ready!.data.patch).toEqual([{ path: 'app/api/reports.ts', content: 'safe();' }])
    // The HITL moat: the run rests at ready — no WorkItem STATE change on
    // success. (No cooldown-clearing write either here: fixFailureCount was
    // already 0, so there is nothing to reset — see the dedicated test below
    // for the case where there IS something to clear.)
    expect(workItemUpdates).toHaveLength(0)
  })

  it('a successful run after prior failures clears the fix cooldown counters (never touches state)', async () => {
    const { deps, workItemUpdates } = baseDeps({}, { fixFailureCount: 2 })
    const res = await driveFix('wi-1', deps)

    expect(res).toEqual({ ok: true, status: 'fixed' })
    expect(workItemUpdates).toEqual([
      { id: 'wi-1', data: { fixFailureCount: 0, fixFailureAt: null } },
    ])
  })

  it('a fix_failed response lands the container in fix_failed, returns the WorkItem to open, and bumps the cooldown counters', async () => {
    const failResp: FixResponseBody = { status: 'fix_failed', reason: 'could not author a safe fix', patch: [] }
    const { deps, containerUpdates, workItemUpdates } = baseDeps({ fetchFix: async () => failResp })
    const res = await driveFix('wi-1', deps)

    expect(res).toEqual({ ok: true, status: 'fix_failed' })
    expect(containerUpdates.some((u) => u.data.state === 'fix_failed')).toBe(true)
    expect(workItemUpdates).toHaveLength(1)
    expect(workItemUpdates[0].id).toBe('wi-1')
    expect(workItemUpdates[0].data.state).toBe('open')
    expect(workItemUpdates[0].data.fixFailureCount).toEqual({ increment: 1 })
    expect(workItemUpdates[0].data.fixFailureAt).toBeInstanceOf(Date)
  })

  it('treats a "fixed" response with an EMPTY patch as a failure — never advances to ready', async () => {
    const emptyFixed: FixResponseBody = { status: 'fixed', patch: [] }
    const { deps, containerUpdates } = baseDeps({ fetchFix: async () => emptyFixed })
    const res = await driveFix('wi-1', deps)

    expect(res.status).toBe('fix_failed')
    expect(containerUpdates.some((u) => u.data.state === 'ready')).toBe(false)
    expect(containerUpdates.some((u) => u.data.state === 'fix_failed')).toBe(true)
  })

  it('fails honestly when no model is connected — never calls agents /fix', async () => {
    const fetchFix = vi.fn()
    const { deps, containerUpdates, workItemUpdates } = baseDeps({
      resolveModel: async () => undefined,
      fetchFix,
    })
    const res = await driveFix('wi-1', deps)

    expect(res.status).toBe('fix_failed')
    expect(fetchFix).not.toHaveBeenCalled()
    expect(containerUpdates.some((u) => u.data.state === 'fix_failed')).toBe(true)
    expect(workItemUpdates[0].data.state).toBe('open')
    expect(workItemUpdates[0].data.fixFailureCount).toEqual({ increment: 1 })
  })

  it('an agents /fix transport error becomes a fix_failed, never thrown', async () => {
    const { deps } = baseDeps({
      fetchFix: async () => {
        throw new Error('agents /fix responded 503')
      },
    })
    const res = await driveFix('wi-1', deps)
    expect(res).toEqual({ ok: true, status: 'fix_failed' })
  })

  it('returns not_found for an unknown work item', async () => {
    const { deps } = baseDeps({
      prisma: { ...baseDeps().deps.prisma, workItem: { findUnique: async () => null, update: async () => ({}) } },
    })
    const res = await driveFix('missing', deps)
    expect(res).toEqual({ ok: false, reason: 'not_found' })
  })

  describe('idempotent terminate', () => {
    it('a container already at `ready` is not re-processed on a second call — no new writes', async () => {
      const { deps, containerUpdates, workItemUpdates } = baseDeps()
      const first = await driveFix('wi-1', deps)
      expect(first).toEqual({ ok: true, status: 'fixed' })
      const containerWritesAfterFirst = containerUpdates.length
      const workItemWritesAfterFirst = workItemUpdates.length

      const second = await driveFix('wi-1', deps)
      expect(second).toEqual({ ok: true, status: 'fixed' })
      expect(containerUpdates).toHaveLength(containerWritesAfterFirst)
      expect(workItemUpdates).toHaveLength(workItemWritesAfterFirst)
    })

    it('a container already at `fix_failed` is not re-processed on a second call — no double-counted failure', async () => {
      const failResp: FixResponseBody = { status: 'fix_failed', reason: 'nope', patch: [] }
      const { deps, containerUpdates, workItemUpdates } = baseDeps({ fetchFix: async () => failResp })
      const first = await driveFix('wi-1', deps)
      expect(first).toEqual({ ok: true, status: 'fix_failed' })
      const containerWritesAfterFirst = containerUpdates.length
      const workItemWritesAfterFirst = workItemUpdates.length

      const second = await driveFix('wi-1', deps)
      expect(second).toEqual({ ok: true, status: 'fix_failed' })
      // Calling terminate twice writes state once — the second call must not
      // increment fixFailureCount again or re-write the container.
      expect(containerUpdates).toHaveLength(containerWritesAfterFirst)
      expect(workItemUpdates).toHaveLength(workItemWritesAfterFirst)
    })
  })
})
