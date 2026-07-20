import { describe, it, expect, vi } from 'vitest'
import { runFixJob, type FixRunDeps, type FixResponseBody } from './run.js'

const ITEM = {
  id: 'wi-1',
  installationId: 'inst-1',
  kind: 'issue',
  title: 'SQL injection',
  detail: 'raw q into db.raw',
  dimension: 'security',
  confidence: 0.8,
  evidence: [{ path: 'app/api/reports.ts', line: 3 }],
  state: 'fixing',
  containerId: 'cont-1',
}

const FIXED: FixResponseBody = {
  status: 'fixed',
  patch: [{ path: 'app/api/reports.ts', content: 'parameterized()' }],
  transcript: [
    {
      agent: 'security',
      action: 'author',
      detail: 'Parameterized the query',
      report: { status: 'done', confidence: 0.9, blockers: [] },
    },
    { agent: 'security', action: 'verify', detail: 'Diff demonstrably fixes the issue' },
  ],
  verification: { verdict: 'verified', checks: ['auto_resolver'] },
}

function fakeDeps(response: () => Promise<FixResponseBody>, item: Record<string, unknown> | null = ITEM) {
  const containerSaves: Array<{ state: string; transcript: unknown[]; patch?: unknown }> = []
  const itemUpdates: Array<Record<string, unknown>> = []
  const deps: FixRunDeps = {
    prisma: {
      workItem: {
        findUnique: vi.fn(async () => item as never),
        update: vi.fn(async (args: unknown) => {
          itemUpdates.push((args as { data: Record<string, unknown> }).data)
          return {}
        }),
      },
      issueContainer: {
        findFirst: vi.fn(async () => ({ id: 'cont-1', state: 'detecting', pr: { base: 'main' } })),
        updateMany: vi.fn(async (args: unknown) => {
          const data = (args as { data: { state: string; transcript: unknown[]; patch?: unknown } }).data
          containerSaves.push(JSON.parse(JSON.stringify(data)))
          return { count: 1 }
        }),
      },
      installation: { findUnique: vi.fn(async () => ({ id: 'inst-1', externalId: 42 })) },
      repository: { findFirst: vi.fn(async () => ({ fullName: 'acme/api' })) },
    },
    resolveModel: vi.fn(async () => ({ provider: 'ollama', model: 'qwen2.5-coder' }) as never),
    mintToken: vi.fn(async () => 'ghs_tok'),
    fetchFix: vi.fn(response),
    now: () => '2026-07-19T00:00:00.000Z',
  }
  return { deps, containerSaves, itemUpdates }
}

describe('runFixJob', () => {
  it('advances fanning_out → verifying → composing (patch attached) → ready, and leaves the item fixing', async () => {
    const { deps, containerSaves, itemUpdates } = fakeDeps(async () => FIXED)
    await runFixJob({ workItemId: 'wi-1' }, deps)

    expect(containerSaves.map((s) => s.state)).toEqual(['fanning_out', 'verifying', 'composing', 'ready'])
    expect(containerSaves[2].patch).toEqual(FIXED.patch)
    // transcript grows monotonically and carries the agents report through
    expect(containerSaves[3].transcript.length).toBeGreaterThan(containerSaves[0].transcript.length)
    expect(JSON.stringify(containerSaves[3].transcript)).toContain('"confidence":0.9')
    // HITL moat: the worker never touches the WorkItem on success
    expect(itemUpdates).toEqual([])
  })

  it('sends the frozen §3 request shape (token, defaultBranch from pr.base, full item payload)', async () => {
    const { deps } = fakeDeps(async () => FIXED)
    await runFixJob({ workItemId: 'wi-1' }, deps)
    const body = (deps.fetchFix as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(body).toMatchObject({
      containerId: 'cont-1',
      installationId: 'inst-1',
      repo: { fullName: 'acme/api', defaultBranch: 'main', token: 'ghs_tok' },
      item: { kind: 'issue', title: 'SQL injection', dimension: 'security', confidence: 0.8 },
    })
    expect(body.llm).toBeDefined()
  })

  it('fix_failed: container terminal with the reason in the transcript; item back to open with fixError', async () => {
    const { deps, containerSaves, itemUpdates } = fakeDeps(async () => ({
      status: 'fix_failed',
      reason: 'verification failed: issue still present',
      patch: [],
      transcript: [],
    }))
    await runFixJob({ workItemId: 'wi-1' }, deps)

    expect(containerSaves.at(-1)?.state).toBe('fix_failed')
    expect(JSON.stringify(containerSaves.at(-1)?.transcript)).toContain('verification failed')
    expect(itemUpdates.at(-1)).toMatchObject({
      state: 'open',
      fixError: 'verification failed: issue still present',
    })
  })

  it('grounding double-check: "fixed" with an empty patch is treated as a failure, never staged', async () => {
    const { deps, containerSaves } = fakeDeps(async () => ({ ...FIXED, patch: [] }))
    await runFixJob({ workItemId: 'wi-1' }, deps)
    expect(containerSaves.map((s) => s.state)).not.toContain('ready')
    expect(containerSaves.at(-1)?.state).toBe('fix_failed')
  })

  it('timeout: AbortError becomes fix_failed with reason "timeout"', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const { deps, itemUpdates } = fakeDeps(async () => {
      throw abort
    })
    await runFixJob({ workItemId: 'wi-1' }, deps)
    expect(itemUpdates.at(-1)).toMatchObject({ state: 'open', fixError: 'timeout' })
  })

  it('a stale job (item no longer fixing) is a silent no-op', async () => {
    const { deps, containerSaves, itemUpdates } = fakeDeps(async () => FIXED, { ...ITEM, state: 'open' })
    await runFixJob({ workItemId: 'wi-1' }, deps)
    expect(containerSaves).toEqual([])
    expect(itemUpdates).toEqual([])
  })
})
