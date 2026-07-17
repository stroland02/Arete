import { describe, it, expect, vi } from 'vitest'
import {
  maybeStartScan,
  computeFingerprint,
  type ScanTriggerDeps,
  type ScanResponseBody,
} from './trigger.js'
import type { LlmConfig } from '../resolve-model-connection.js'

function llm(): LlmConfig {
  return { provider: 'anthropic', model: 'claude-opus-4', apiKey: 'sk-DECRYPTED' }
}

function finding(overrides: Partial<{
  kind: 'issue' | 'opportunity'
  title: string
  detail: string
  evidence: { path: string; line: number; excerpt?: string | null }[]
  dimension: string
  confidence: number
}> = {}) {
  return {
    kind: 'issue' as const,
    title: 'Unvalidated input in reports endpoint',
    detail: 'The reports endpoint interpolates a query param into SQL.',
    evidence: [{ path: 'app/api/reports.ts', line: 12, excerpt: 'db.raw(q)' }],
    dimension: 'security',
    confidence: 0.82,
    ...overrides,
  }
}

/** Build fake deps. `existingItems` seeds WorkItem rows keyed by fingerprint. */
function deps(opts: {
  model?: LlmConfig | null
  repos?: number
  runningScan?: boolean
  scan?: ScanResponseBody | 'reject'
  existingItems?: { fingerprint: string; state: string }[]
} = {}) {
  const existing = new Map(
    (opts.existingItems ?? []).map((i) => [i.fingerprint, { id: `wi-${i.fingerprint.slice(0, 8)}`, state: i.state }]),
  )

  const installationFindUnique = vi.fn().mockResolvedValue({ id: 'inst-1', externalId: 987654 })
  const repositoryFindFirst = vi.fn().mockResolvedValue(
    (opts.repos ?? 1) > 0 ? { id: 'repo-1', fullName: 'acme/shop' } : null,
  )
  const scanRunFindFirst = vi.fn().mockResolvedValue(opts.runningScan ? { id: 'run-existing' } : null)
  const scanRunCreate = vi.fn().mockResolvedValue({ id: 'run-1' })
  const scanRunUpdate = vi.fn().mockResolvedValue({ id: 'run-1' })
  const workItemFindUnique = vi.fn(async (args: unknown) => {
    const where = (args as { where: { installationId_fingerprint: { fingerprint: string } } }).where
    return existing.get(where.installationId_fingerprint.fingerprint) ?? null
  })
  const workItemCreate = vi.fn().mockResolvedValue({ id: 'wi-new' })
  const workItemUpdate = vi.fn().mockResolvedValue({ id: 'wi-upd' })
  const resolveModel = vi.fn().mockResolvedValue('model' in opts ? (opts.model ?? undefined) : llm())
  const fetchScan = vi.fn(async () => {
    if (opts.scan === 'reject') throw new Error('agents /scan unreachable')
    return opts.scan ?? { status: 'complete' as const, findings: [finding()] }
  })

  const d: ScanTriggerDeps = {
    prisma: {
      installation: { findUnique: installationFindUnique },
      repository: { findFirst: repositoryFindFirst },
      scanRun: { findFirst: scanRunFindFirst, create: scanRunCreate, update: scanRunUpdate },
      workItem: { findUnique: workItemFindUnique, create: workItemCreate, update: workItemUpdate },
    },
    resolveModel,
    fetchScan,
  }
  return {
    d,
    installationFindUnique,
    repositoryFindFirst,
    scanRunFindFirst,
    scanRunCreate,
    scanRunUpdate,
    workItemFindUnique,
    workItemCreate,
    workItemUpdate,
    resolveModel,
    fetchScan,
  }
}

describe('maybeStartScan — repo+model gated, honest ScanRun status', () => {
  it('does not start without a model connection', async () => {
    const { d, scanRunCreate, fetchScan } = deps({ model: null, repos: 1 })
    const r = await maybeStartScan('inst-1', d)
    expect(r).toEqual({ started: false, reason: 'no_model' })
    expect(scanRunCreate).not.toHaveBeenCalled()
    expect(fetchScan).not.toHaveBeenCalled()
  })

  it('does not start without a connected repository', async () => {
    const { d, scanRunCreate } = deps({ repos: 0 })
    const r = await maybeStartScan('inst-1', d)
    expect(r).toEqual({ started: false, reason: 'no_repo' })
    expect(scanRunCreate).not.toHaveBeenCalled()
  })

  it('409s a second scan while one runs', async () => {
    const d = deps({ model: llm(), repos: 1, runningScan: true })
    expect(await maybeStartScan('inst-1', d.d)).toEqual({ started: false, reason: 'already_running' })
    expect(d.scanRunCreate).not.toHaveBeenCalled()
  })

  it('records failed ScanRun with the error when /scan errors', async () => {
    const { d, scanRunUpdate } = deps({ scan: 'reject' })
    const r = await maybeStartScan('inst-1', d)
    expect(r.started).toBe(true)
    expect(scanRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('agents /scan unreachable'),
        }),
      }),
    )
  })

  it('creates open WorkItems (fingerprinted, tenant-scoped) from findings and completes the run', async () => {
    const { d, workItemCreate, scanRunUpdate, fetchScan } = deps({})
    const r = await maybeStartScan('inst-1', d)
    expect(r).toEqual({ started: true })
    // the agents call carries the tenant's numeric id, repo slug and llm block
    expect(fetchScan).toHaveBeenCalledWith({
      installationId: 987654,
      repoSlug: 'acme/shop',
      llm: llm(),
    })
    const fp = computeFingerprint('inst-1', 'security', ['app/api/reports.ts'])
    expect(workItemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        installationId: 'inst-1',
        kind: 'issue',
        source: 'scan',
        state: 'open',
        fingerprint: fp,
        scanRunId: 'run-1',
        confidence: 0.82,
      }),
    })
    expect(scanRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'complete' }),
      }),
    )
  })

  it('upserts findings by fingerprint and never resurrects dismissed items', async () => {
    const fp = computeFingerprint('inst-1', 'security', ['app/api/reports.ts'])
    const { d, workItemCreate, workItemUpdate } = deps({
      existingItems: [{ fingerprint: fp, state: 'dismissed' }],
    })
    const r = await maybeStartScan('inst-1', d)
    expect(r).toEqual({ started: true })
    // a dismissal is a decision — the item is neither recreated nor updated
    expect(workItemCreate).not.toHaveBeenCalled()
    expect(workItemUpdate).not.toHaveBeenCalled()
  })

  it('updates (not duplicates) an existing open item with the same fingerprint', async () => {
    const fp = computeFingerprint('inst-1', 'security', ['app/api/reports.ts'])
    const { d, workItemCreate, workItemUpdate } = deps({
      existingItems: [{ fingerprint: fp, state: 'open' }],
    })
    await maybeStartScan('inst-1', d)
    expect(workItemCreate).not.toHaveBeenCalled()
    expect(workItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: `wi-${fp.slice(0, 8)}` },
        data: expect.objectContaining({ scanRunId: 'run-1' }),
      }),
    )
  })

  it('marks no_findings when the scan returns empty', async () => {
    const { d, workItemCreate, scanRunUpdate } = deps({
      scan: { status: 'no_findings', findings: [] },
    })
    const r = await maybeStartScan('inst-1', d)
    expect(r).toEqual({ started: true })
    expect(workItemCreate).not.toHaveBeenCalled()
    expect(scanRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'no_findings' }),
      }),
    )
  })

  it('never throws to the caller — an unknown installation is a no_repo result', async () => {
    const d = deps({})
    d.installationFindUnique.mockResolvedValue(null)
    expect(await maybeStartScan('missing', d.d)).toEqual({ started: false, reason: 'no_repo' })
  })
})
