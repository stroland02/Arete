import { describe, expect, it, vi } from 'vitest'

import {
  filterResultForPosting,
  guidanceRules,
  loadAgentConfigs,
  type EnforcedAgentConfig,
} from './agent-config.js'
import type { ReviewResult } from './types.js'

/**
 * Enforcement of per-agent config on what gets POSTED. The stored rows were
 * decoration until the worker consumed them; these tests pin the consumption:
 * absence of a row is the pre-feature behaviour, the persisted result is never
 * touched, and a config that cannot be read enforces nothing.
 */

function comment(category: string, severity: 'info' | 'warning' | 'error') {
  return { path: 'a.ts', line: 1, body: `${category} ${severity}`, severity, category }
}

function result(...comments: ReturnType<typeof comment>[]): ReviewResult {
  return {
    risk_level: 'low',
    overall_summary: 'fine',
    file_reviews: [{ path: 'a.ts', comments }],
  } as unknown as ReviewResult
}

const cfg = (over: Partial<EnforcedAgentConfig> = {}): EnforcedAgentConfig => ({
  enabled: true,
  severityThreshold: 'info',
  guidance: '',
  ...over,
})

describe('filterResultForPosting', () => {
  it('drops findings below the agent severity threshold, and counts them', () => {
    const configs = new Map([['security', cfg({ severityThreshold: 'error' })]])
    const input = result(
      comment('security', 'info'),
      comment('security', 'warning'),
      comment('security', 'error'),
    )
    const { result: postable, suppressed } = filterResultForPosting(input, configs)

    expect(postable.file_reviews[0].comments.map((c) => c.severity)).toEqual(['error'])
    expect(suppressed).toBe(2)
  })

  it('drops every finding from a disabled agent', () => {
    const configs = new Map([['security', cfg({ enabled: false })]])
    const input = result(comment('security', 'error'), comment('performance', 'info'))
    const { result: postable, suppressed } = filterResultForPosting(input, configs)

    // The performance agent has no row and is untouched — absence is the
    // pre-feature behaviour, not a policy.
    expect(postable.file_reviews[0].comments.map((c) => c.category)).toEqual(['performance'])
    expect(suppressed).toBe(1)
  })

  it('never mutates the input — the persisted result is the unfiltered one', () => {
    const configs = new Map([['security', cfg({ enabled: false })]])
    const input = result(comment('security', 'error'))

    filterResultForPosting(input, configs)

    // The same posted/persisted split noise_state established: the dashboard
    // shows everything found; the PR shows what the tenant asked to see.
    expect(input.file_reviews[0].comments).toHaveLength(1)
  })

  it('passes everything through when no configs exist', () => {
    const input = result(comment('security', 'info'))
    const { result: postable, suppressed } = filterResultForPosting(input, new Map())
    expect(postable).toBe(input)
    expect(suppressed).toBe(0)
  })

  it('keeps a comment whose severity it does not recognise', () => {
    // An unknown severity ranks as error — visible — rather than silently
    // suppressed. Suppression must never be the failure mode of a bad value.
    const configs = new Map([['security', cfg({ severityThreshold: 'error' })]])
    const weird = { ...comment('security', 'error'), severity: 'catastrophic' as never }
    const { result: postable } = filterResultForPosting(result(weird), configs)
    expect(postable.file_reviews[0].comments).toHaveLength(1)
  })
})

describe('guidanceRules', () => {
  it('emits one attributed line per enabled agent with guidance', () => {
    const configs = new Map([
      ['security', cfg({ guidance: 'Watch the payments module.' })],
      ['performance', cfg({ guidance: '  ' })],
      ['quality', cfg({ enabled: false, guidance: 'Ignored — agent is off.' })],
    ])
    // Attribution matters: customRules reach every specialist, and an
    // unattributed steer meant for one agent reads as an order to all of them.
    expect(guidanceRules(configs)).toEqual(['[security agent] Watch the payments module.'])
  })
})

describe('loadAgentConfigs', () => {
  const db = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      installation: { findFirst: vi.fn().mockResolvedValue({ id: 'inst-uuid' }) },
      agentConfig: {
        findMany: vi.fn().mockResolvedValue([
          { agentId: 'security', enabled: false, severityThreshold: 'error', guidance: 'strict' },
        ]),
      },
      ...over,
    }) as never

  it('resolves the internal installation from the external id and keys by agent', async () => {
    const client = db()
    const configs = await loadAgentConfigs(987654, client)

    expect(configs.get('security')).toEqual({
      enabled: false,
      severityThreshold: 'error',
      guidance: 'strict',
    })
    expect((client as { agentConfig: { findMany: ReturnType<typeof vi.fn> } }).agentConfig.findMany)
      .toHaveBeenCalledWith(expect.objectContaining({ where: { installationId: 'inst-uuid' } }))
  })

  it('is empty for an unknown installation', async () => {
    const configs = await loadAgentConfigs(1, db({
      installation: { findFirst: vi.fn().mockResolvedValue(null) },
    }))
    expect(configs.size).toBe(0)
  })

  it('is empty — enforcing nothing — when the read fails', async () => {
    // Enforcing a guess would silently reshape a review. A database problem
    // must degrade to exactly the pre-feature behaviour.
    const configs = await loadAgentConfigs(1, db({
      installation: { findFirst: vi.fn().mockRejectedValue(new Error('db down')) },
    }))
    expect(configs.size).toBe(0)
  })

  it('normalises an unrecognised stored threshold to info, never to silence', async () => {
    const configs = await loadAgentConfigs(1, db({
      agentConfig: {
        findMany: vi.fn().mockResolvedValue([
          { agentId: 'security', enabled: true, severityThreshold: 'renamed-later', guidance: '' },
        ]),
      },
    }))
    expect(configs.get('security')?.severityThreshold).toBe('info')
  })
})
