import { describe, it, expect, vi } from 'vitest'
import { driveFix, type FixTriggerDeps, type FixResponseBody } from './trigger.js'

function baseDeps(overrides: Partial<FixTriggerDeps> = {}): {
  deps: FixTriggerDeps
  containerUpdates: { id: string; data: Record<string, unknown> }[]
  workItemUpdates: { id: string; data: Record<string, unknown> }[]
} {
  const containerUpdates: { id: string; data: Record<string, unknown> }[] = []
  const workItemUpdates: { id: string; data: Record<string, unknown> }[] = []
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
        }),
        update: async (args: any) => {
          workItemUpdates.push({ id: args.where.id, data: args.data })
          return {}
        },
      },
      installation: { findUnique: async () => ({ id: 'inst-uuid', externalId: 4242 }) },
      repository: { findFirst: async () => ({ id: 'repo-1', fullName: 'acme/api' }) },
      issueContainer: {
        update: async (args: any) => {
          containerUpdates.push({ id: args.where.id, data: args.data })
          return {}
        },
      },
    },
    resolveModel: async () => ({ provider: 'ollama', model: 'qwen2.5-coder', baseUrl: 'http://127.0.0.1:11434' }),
    mintToken: async () => 'ghs_token',
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
    // The HITL moat: the run rests at ready — no WorkItem state change on success.
    expect(workItemUpdates).toHaveLength(0)
  })

  it('a fix_failed response lands the container in fix_failed and returns the WorkItem to open', async () => {
    const failResp: FixResponseBody = { status: 'fix_failed', reason: 'could not author a safe fix', patch: [] }
    const { deps, containerUpdates, workItemUpdates } = baseDeps({ fetchFix: async () => failResp })
    const res = await driveFix('wi-1', deps)

    expect(res).toEqual({ ok: true, status: 'fix_failed' })
    expect(containerUpdates.some((u) => u.data.state === 'fix_failed')).toBe(true)
    expect(workItemUpdates).toEqual([{ id: 'wi-1', data: { state: 'open' } }])
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
    expect(workItemUpdates).toEqual([{ id: 'wi-1', data: { state: 'open' } }])
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
})
