import { describe, it, expect, vi } from 'vitest'
import { syncReviewFindings, type ReviewSyncDeps } from './review-sync.js'
import { computeFingerprint } from './trigger.js'

function comment(overrides: Partial<{
  path: string
  line: number
  body: string
  category: string
  severity: string
  confidence: number
}> = {}) {
  return {
    path: 'src/auth.ts',
    line: 42,
    body: 'Session token compared with == instead of a constant-time check.',
    category: 'security',
    severity: 'error',
    ...overrides,
  }
}

/** Fake deps backed by an in-memory WorkItem map keyed by fingerprint. */
function deps(existingItems: { fingerprint: string; state: string }[] = []) {
  const existing = new Map(
    existingItems.map((i) => [i.fingerprint, { id: `wi-${i.fingerprint.slice(0, 8)}`, state: i.state }]),
  )
  const findUnique = vi.fn(async (args: unknown) => {
    const where = (args as { where: { installationId_fingerprint: { fingerprint: string } } }).where
    return existing.get(where.installationId_fingerprint.fingerprint) ?? null
  })
  const create = vi.fn().mockResolvedValue({ id: 'wi-new' })
  const update = vi.fn().mockResolvedValue({ id: 'wi-upd' })
  const d: ReviewSyncDeps = { prisma: { workItem: { findUnique, create, update } } }
  return { d, findUnique, create, update }
}

describe('syncReviewFindings — PR-review findings land in the inbox', () => {
  it('inserts one pr_finding WorkItem per error/warning comment', async () => {
    const { d, create } = deps()
    const n = await syncReviewFindings(
      'inst-1',
      'rev-1',
      [comment(), comment({ path: 'src/db.ts', line: 7, severity: 'warning', category: 'performance' })],
      d,
    )
    expect(n).toBe(2)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        installationId: 'inst-1',
        kind: 'pr_finding',
        source: 'review',
        state: 'open',
        dimension: 'security',
        evidence: [{ path: 'src/auth.ts', line: 42 }],
        fingerprint: computeFingerprint('inst-1', 'security', ['src/auth.ts']),
      }),
    })
  })

  it('skips info-severity comments', async () => {
    const { d, create } = deps()
    const n = await syncReviewFindings('inst-1', 'rev-1', [comment({ severity: 'info' })], d)
    expect(n).toBe(0)
    expect(create).not.toHaveBeenCalled()
  })

  it('re-run inserts 0 new items (fingerprint dedup) and never resurrects dismissed', async () => {
    const fpOpen = computeFingerprint('inst-1', 'security', ['src/auth.ts'])
    const fpDismissed = computeFingerprint('inst-1', 'performance', ['src/db.ts'])
    const { d, create, update } = deps([
      { fingerprint: fpOpen, state: 'open' },
      { fingerprint: fpDismissed, state: 'dismissed' },
    ])
    const n = await syncReviewFindings(
      'inst-1',
      'rev-2',
      [comment(), comment({ path: 'src/db.ts', line: 7, severity: 'warning', category: 'performance' })],
      d,
    )
    expect(n).toBe(0)
    expect(create).not.toHaveBeenCalled()
    // the open item may refresh, the dismissed one must stay untouched
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: `wi-${fpDismissed.slice(0, 8)}` } }),
    )
  })

  it('defaults confidence to 0.5 with the detail noting unscored when the review carries none', async () => {
    const { d, create } = deps()
    await syncReviewFindings('inst-1', 'rev-1', [comment()], d)
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        confidence: 0.5,
        detail: expect.stringContaining('unscored'),
      }),
    })
  })

  it('uses the stored confidence when present', async () => {
    const { d, create } = deps()
    await syncReviewFindings('inst-1', 'rev-1', [comment({ confidence: 0.91 })], d)
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ confidence: 0.91 }),
    })
    const detail = (create.mock.calls[0]![0] as { data: { detail: string } }).data.detail
    expect(detail).not.toContain('unscored')
  })
})
