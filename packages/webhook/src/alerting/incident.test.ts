import { describe, it, expect, vi } from 'vitest'
import { routeIncidentToFix, type RouteIncidentDeps } from './incident.js'

// routeIncidentToFix is the pure business-logic core of Task 4: an Incident of
// severity "critical" opens exactly one WorkItem (linked back via
// Incident.workItemId) and dispatches it into the EXISTING fix path (create
// an IssueContainer, flip the WorkItem to `fixing`, enqueue the fix-drive
// job) — never a second trigger route. Warnings record-only. These tests
// drive it against fake stores that mimic the real unique-constraint
// semantics of both Incident (installationId, fingerprint) and WorkItem
// (installationId, fingerprint) so the idempotency/race behavior can be
// asserted without a real Postgres.

interface FakeIncidentRow {
  id: string
  installationId: string
  fingerprint: string
  alertName: string
  severity: string
  status: string
  summary: string
  workItemId: string | null
}

interface FakeWorkItemRow {
  id: string
  installationId: string
  fingerprint: string
  kind: string
  source: string
  title: string
  detail: string
  evidence: unknown
  dimension: string
  confidence: number
  state: string
  containerId: string | null
}

function makeFakeStores() {
  const incidents = new Map<string, FakeIncidentRow>()
  const workItems = new Map<string, FakeWorkItemRow>()
  const containers = new Map<string, { id: string; installationId: string; state: string }>()
  let workItemSeq = 0
  let containerSeq = 0

  const incident = {
    findUnique: vi.fn(async (args: any) => incidents.get(args.where.id) ?? null),
    update: vi.fn(async (args: any) => {
      const row = incidents.get(args.where.id)
      if (!row) throw new Error('not found')
      Object.assign(row, args.data)
      return row
    }),
  }

  const workItem = {
    create: vi.fn(async (args: any) => {
      const key = `${args.data.installationId}::${args.data.fingerprint}`
      for (const row of workItems.values()) {
        if (`${row.installationId}::${row.fingerprint}` === key) {
          const err: any = new Error('Unique constraint failed on the fields: (`installationId`,`fingerprint`)')
          err.code = 'P2002'
          throw err
        }
      }
      workItemSeq += 1
      const row: FakeWorkItemRow = {
        id: `wi-${workItemSeq}`,
        containerId: null,
        ...args.data,
      }
      workItems.set(row.id, row)
      return row
    }),
    findUnique: vi.fn(async (args: any) => {
      if (args.where.installationId_fingerprint) {
        const { installationId, fingerprint } = args.where.installationId_fingerprint
        for (const row of workItems.values()) {
          if (row.installationId === installationId && row.fingerprint === fingerprint) return row
        }
        return null
      }
      return workItems.get(args.where.id) ?? null
    }),
    update: vi.fn(async (args: any) => {
      const row = workItems.get(args.where.id)
      if (!row) throw new Error('not found')
      Object.assign(row, args.data)
      return row
    }),
  }

  const repository = {
    findFirst: vi.fn(async (args: any) => {
      if (args.where.installationId === 'no-repo-installation') return null
      return { fullName: `${args.where.installationId}/repo` }
    }),
  }

  const issueContainer = {
    create: vi.fn(async (args: any) => {
      containerSeq += 1
      const row = { id: `container-${containerSeq}`, ...args.data }
      containers.set(row.id, row)
      return row
    }),
  }

  return { incident, workItem, repository, issueContainer, incidents, workItems, containers }
}

function seedIncident(store: ReturnType<typeof makeFakeStores>, overrides: Partial<FakeIncidentRow> = {}): FakeIncidentRow {
  const row: FakeIncidentRow = {
    id: 'incident-1',
    installationId: 'inst-a',
    fingerprint: 'fp-1',
    alertName: 'AreteReviewErrorRate',
    severity: 'critical',
    status: 'firing',
    summary: 'Arete review error rate above 10%',
    workItemId: null,
    ...overrides,
  }
  store.incidents.set(row.id, row)
  return row
}

function makeDeps(store: ReturnType<typeof makeFakeStores>, overrides: Partial<RouteIncidentDeps> = {}): RouteIncidentDeps {
  return {
    prisma: {
      incident: store.incident,
      workItem: store.workItem,
      repository: store.repository,
      issueContainer: store.issueContainer,
    },
    enqueueFixDrive: vi.fn(async () => undefined),
    checkCooldown: vi.fn(async () => ({ allowed: true })),
    ...overrides,
  }
}

describe('routeIncidentToFix', () => {
  it('a critical incident opens exactly one WorkItem and links it back', async () => {
    const store = makeFakeStores()
    seedIncident(store)
    const deps = makeDeps(store)

    const result = await routeIncidentToFix('incident-1', deps)

    expect(result.routed).toBe(true)
    expect(result.workItemId).toBeDefined()
    expect(store.workItems.size).toBe(1)
    const wi = [...store.workItems.values()][0]
    expect(wi).toMatchObject({
      kind: 'error',
      installationId: 'inst-a',
      dimension: expect.any(String),
      confidence: expect.any(Number),
    })
    expect(wi.confidence).toBeGreaterThanOrEqual(0)
    expect(wi.confidence).toBeLessThanOrEqual(1)
    expect(store.incidents.get('incident-1')!.workItemId).toBe(wi.id)
    expect(deps.enqueueFixDrive).toHaveBeenCalledTimes(1)
    expect(deps.enqueueFixDrive).toHaveBeenCalledWith({ workItemId: wi.id })
  })

  it('a repeat delivery of the same fingerprint (workItemId already set) does not open a second WorkItem', async () => {
    const store = makeFakeStores()
    seedIncident(store)
    const deps = makeDeps(store)

    const first = await routeIncidentToFix('incident-1', deps)
    const second = await routeIncidentToFix('incident-1', deps)

    expect(first.routed).toBe(true)
    expect(second.routed).toBe(false)
    expect(second.reason).toBe('already_routed')
    expect(store.workItems.size).toBe(1)
    expect(deps.enqueueFixDrive).toHaveBeenCalledTimes(1)
  })

  it('two concurrent deliveries that both observe workItemId=null still open exactly one WorkItem and dispatch exactly one fix drive', async () => {
    // Simulates the TOCTOU race the brief calls out: two deliveries both read
    // the incident before either has written workItemId back. The real guard
    // is WorkItem's own (installationId, fingerprint) unique constraint, not
    // app-level "read null, then act" sequencing.
    const store = makeFakeStores()
    seedIncident(store)
    const deps = makeDeps(store)

    const [a, b] = await Promise.all([
      routeIncidentToFix('incident-1', deps),
      routeIncidentToFix('incident-1', deps),
    ])

    const routedCount = [a, b].filter((r) => r.routed).length
    expect(routedCount).toBe(1)
    expect(store.workItems.size).toBe(1)
    expect(deps.enqueueFixDrive).toHaveBeenCalledTimes(1)
    expect(store.incidents.get('incident-1')!.workItemId).toBe([...store.workItems.values()][0].id)
  })

  it('a warning-severity incident opens no WorkItem', async () => {
    const store = makeFakeStores()
    seedIncident(store, { severity: 'warning' })
    const deps = makeDeps(store)

    const result = await routeIncidentToFix('incident-1', deps)

    expect(result.routed).toBe(false)
    expect(result.reason).toBe('not_critical')
    expect(store.workItems.size).toBe(0)
    expect(deps.enqueueFixDrive).not.toHaveBeenCalled()
  })

  it('the created WorkItem carries the incident installationId and nothing cross-tenant', async () => {
    const store = makeFakeStores()
    seedIncident(store, { id: 'incident-a', installationId: 'inst-a', fingerprint: 'fp-shared' })
    seedIncident(store, { id: 'incident-b', installationId: 'inst-b', fingerprint: 'fp-shared' })
    const deps = makeDeps(store)

    await routeIncidentToFix('incident-a', deps)
    await routeIncidentToFix('incident-b', deps)

    expect(store.workItems.size).toBe(2)
    const rows = [...store.workItems.values()]
    const forA = rows.find((r) => r.installationId === 'inst-a')
    const forB = rows.find((r) => r.installationId === 'inst-b')
    expect(forA).toBeDefined()
    expect(forB).toBeDefined()
    expect(forA!.id).not.toBe(forB!.id)
  })

  it('does not route an incident that does not exist', async () => {
    const store = makeFakeStores()
    const deps = makeDeps(store)
    const result = await routeIncidentToFix('missing', deps)
    expect(result).toEqual({ routed: false, reason: 'not_found' })
  })

  it('a resolved critical incident is not routed to a fresh fix drive', async () => {
    const store = makeFakeStores()
    seedIncident(store, { status: 'resolved' })
    const deps = makeDeps(store)
    const result = await routeIncidentToFix('incident-1', deps)
    expect(result.routed).toBe(false)
    expect(store.workItems.size).toBe(0)
  })

  it('respects an active fix cooldown rather than bypassing it — WorkItem still opens, but no drive is enqueued', async () => {
    const store = makeFakeStores()
    seedIncident(store)
    const deps = makeDeps(store, { checkCooldown: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 300 })) })

    const result = await routeIncidentToFix('incident-1', deps)

    expect(result.routed).toBe(true)
    expect(store.workItems.size).toBe(1)
    expect(deps.enqueueFixDrive).not.toHaveBeenCalled()
  })

  it('when the tenant has no connected repository, the WorkItem still opens but no container/fix drive is dispatched', async () => {
    const store = makeFakeStores()
    seedIncident(store, { installationId: 'no-repo-installation' })
    const deps = makeDeps(store)

    const result = await routeIncidentToFix('incident-1', deps)

    expect(result.routed).toBe(true)
    expect(store.workItems.size).toBe(1)
    expect(store.containers.size).toBe(0)
    expect(deps.enqueueFixDrive).not.toHaveBeenCalled()
  })

  it('never throws even if a dependency rejects', async () => {
    const store = makeFakeStores()
    seedIncident(store)
    const deps = makeDeps(store, {
      prisma: {
        incident: store.incident,
        workItem: { ...store.workItem, create: vi.fn(async () => { throw new Error('boom') }) },
        repository: store.repository,
        issueContainer: store.issueContainer,
      },
    })

    await expect(routeIncidentToFix('incident-1', deps)).resolves.toMatchObject({ routed: false })
  })
})
