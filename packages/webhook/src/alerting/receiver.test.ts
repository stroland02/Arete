import { describe, it, expect, vi, beforeEach } from 'vitest'

// handleIncomingAlert is the pure business-logic core behind POST
// /alerts/incoming (route wiring + the auth-rejection mutation test live in
// server.test.ts, matching the split already used for /fix/trigger). These
// tests drive it against a fake prisma.incident store that mimics the real
// (installationId, fingerprint) compound-unique semantics (Task 2's
// @@unique([installationId, fingerprint])) so the idempotency, resolution,
// scrubbing, and tenancy behavior can be asserted without a real Postgres.

interface FakeIncidentRow {
  id: string
  installationId: string
  fingerprint: string
  alertName: string
  severity: string
  status: string
  summary: string
  payload: unknown
  startsAt: Date
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
  workItemId: string | null
}

function makeFakeIncidentStore() {
  const rows = new Map<string, FakeIncidentRow>()
  let seq = 0
  const key = (installationId: string, fingerprint: string) => `${installationId}::${fingerprint}`

  const incident = {
    // Task 4's routeIncidentToFix looks incidents up by id (Incident.workItemId
    // has no Prisma relation, so it is never reached by traversal — see
    // incident.ts's header) — support both shapes this suite's callers use.
    findUnique: vi.fn(async (args: any) => {
      if (args.where?.id) {
        for (const row of rows.values()) if (row.id === args.where.id) return row
        return null
      }
      const { installationId, fingerprint } = args.where.installationId_fingerprint
      return rows.get(key(installationId, fingerprint)) ?? null
    }),
    update: vi.fn(async (args: any) => {
      for (const [k, row] of rows.entries()) {
        if (row.id === args.where.id) {
          const updated = { ...row, ...args.data }
          rows.set(k, updated)
          return updated
        }
      }
      throw new Error('not found')
    }),
    upsert: vi.fn(async (args: any) => {
      const { installationId, fingerprint } = args.where.installationId_fingerprint
      const k = key(installationId, fingerprint)
      const existing = rows.get(k)
      const now = new Date()
      if (existing) {
        const updated: FakeIncidentRow = { ...existing, ...args.update, updatedAt: now }
        rows.set(k, updated)
        return updated
      }
      seq += 1
      const created: FakeIncidentRow = {
        id: `incident-${seq}`,
        createdAt: now,
        updatedAt: now,
        ...args.create,
      }
      rows.set(k, created)
      return created
    }),
  }
  return { incident, rows }
}

function baseAlert(overrides: Record<string, unknown> = {}) {
  return {
    status: 'firing',
    labels: {
      alertname: 'AreteReviewErrorRate',
      severity: 'critical',
      installationId: 'inst-a',
    },
    annotations: {
      summary: 'Arete review error rate above 10%',
      description: 'more than 10% of runs failed',
    },
    startsAt: '2026-07-21T00:00:00Z',
    fingerprint: 'fp-1',
    ...overrides,
  }
}

async function loadReceiver(store: ReturnType<typeof makeFakeIncidentStore>) {
  // Task 4 (incident.ts) reads incident.workItemId via the SAME '../db.js'
  // import right after every upsert. This suite is only exercising the
  // record/upsert behavior, so the WorkItem side is stubbed minimally:
  // repository.findFirst -> null makes routeIncidentToFix's dispatchFixDrive
  // early-return right after opening the WorkItem, without needing to also
  // fake issueContainer/queue/cooldown. routeIncidentToFix's own contract
  // never throws, so leaving it unstubbed would already be safe (just
  // logged-and-swallowed) — this is here so the suite's real assertions on
  // `created`/`updated` are exercised against genuinely working routing
  // rather than a routing call that errors out on every alert.
  const workItems = new Map<string, { id: string; installationId: string; fingerprint: string }>()
  let seq = 0
  const workItem = {
    create: vi.fn(async (args: any) => {
      seq += 1
      const row = { id: `wi-${seq}`, ...args.data }
      workItems.set(row.id, row)
      return row
    }),
    findUnique: vi.fn(async (args: any) => {
      if (args.where?.installationId_fingerprint) {
        const { installationId, fingerprint } = args.where.installationId_fingerprint
        for (const row of workItems.values()) {
          if (row.installationId === installationId && row.fingerprint === fingerprint) return row
        }
        return null
      }
      return workItems.get(args.where.id) ?? null
    }),
    update: vi.fn(async () => ({})),
  }
  const repository = { findFirst: vi.fn(async () => null) }
  vi.doMock('../db.js', () => ({ prisma: { incident: store.incident, workItem, repository } }))
  return import('./receiver.js')
}

describe('handleIncomingAlert', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.ARETE_PLATFORM_INSTALLATION_ID
  })

  // Platform-alert attribution (user ruling 2026-07-21). The three rules that
  // actually ship carry no installationId label — a tenant id can never be a
  // metric dimension — so without this fallback the entire alerting chain
  // would work for hand-labelled synthetic alerts only, and every real alert
  // would be silently dropped.
  describe('platform-wide alerts with no installationId label', () => {
    it('attributes to the configured platform installation', async () => {
      process.env.ARETE_PLATFORM_INSTALLATION_ID = 'inst-platform'
      const store = makeFakeIncidentStore()
      const { handleIncomingAlert } = await loadReceiver(store)

      const alert = baseAlert()
      delete (alert.labels as Record<string, unknown>).installationId

      expect(await handleIncomingAlert({ alerts: [alert] })).toEqual({ created: 1, updated: 0 })
      expect([...store.rows.values()][0]).toMatchObject({ installationId: 'inst-platform' })
    })

    it('never overrides an installationId the alert already carries', async () => {
      process.env.ARETE_PLATFORM_INSTALLATION_ID = 'inst-platform'
      const store = makeFakeIncidentStore()
      const { handleIncomingAlert } = await loadReceiver(store)

      await handleIncomingAlert({ alerts: [baseAlert()] })

      // A future per-tenant rule must still attribute to its own tenant.
      expect([...store.rows.values()][0]).toMatchObject({ installationId: 'inst-a' })
    })

    it('still drops when no label and no configured platform installation', async () => {
      const store = makeFakeIncidentStore()
      const { handleIncomingAlert } = await loadReceiver(store)

      const alert = baseAlert()
      delete (alert.labels as Record<string, unknown>).installationId

      // Dropping a platform alert is recoverable; filing it against an
      // arbitrary customer is not. Unset env must not invent an owner.
      expect(await handleIncomingAlert({ alerts: [alert] })).toEqual({ created: 0, updated: 0 })
      expect(store.rows.size).toBe(0)
    })
  })

  it('a valid firing alert creates exactly one Incident', async () => {
    const store = makeFakeIncidentStore()
    const { handleIncomingAlert } = await loadReceiver(store)

    const result = await handleIncomingAlert({ alerts: [baseAlert()] })

    expect(result).toEqual({ created: 1, updated: 0 })
    expect(store.rows.size).toBe(1)
    const row = [...store.rows.values()][0]
    expect(row).toMatchObject({
      installationId: 'inst-a',
      fingerprint: 'fp-1',
      alertName: 'AreteReviewErrorRate',
      severity: 'critical',
      status: 'firing',
    })
  })

  it('the same alert delivered twice creates exactly one row and bumps updatedAt', async () => {
    const store = makeFakeIncidentStore()
    const { handleIncomingAlert } = await loadReceiver(store)

    const first = await handleIncomingAlert({ alerts: [baseAlert()] })
    expect(first).toEqual({ created: 1, updated: 0 })
    const rowAfterFirst = [...store.rows.values()][0]
    const updatedAtAfterFirst = rowAfterFirst.updatedAt

    // Ensure a real clock tick so updatedAt is observably different.
    await new Promise((r) => setTimeout(r, 5))

    const second = await handleIncomingAlert({ alerts: [baseAlert()] })
    expect(second).toEqual({ created: 0, updated: 1 })
    expect(store.rows.size).toBe(1)
    const rowAfterSecond = [...store.rows.values()][0]
    expect(rowAfterSecond.id).toBe(rowAfterFirst.id)
    expect(rowAfterSecond.updatedAt.getTime()).toBeGreaterThan(updatedAtAfterFirst.getTime())
  })

  it('a resolved payload sets status and resolvedAt on the existing row', async () => {
    const store = makeFakeIncidentStore()
    const { handleIncomingAlert } = await loadReceiver(store)

    await handleIncomingAlert({ alerts: [baseAlert()] })
    const resolved = await handleIncomingAlert({
      alerts: [
        baseAlert({
          status: 'resolved',
          endsAt: '2026-07-21T01:00:00Z',
        }),
      ],
    })

    expect(resolved).toEqual({ created: 0, updated: 1 })
    const row = [...store.rows.values()][0]
    expect(row.status).toBe('resolved')
    expect(row.resolvedAt).toBeInstanceOf(Date)
    expect(row.resolvedAt?.toISOString()).toBe('2026-07-21T01:00:00.000Z')
  })

  it('stores an alert whose annotation contains a secret-shaped string scrubbed — the raw secret appears nowhere in the persisted row', async () => {
    const store = makeFakeIncidentStore()
    const { handleIncomingAlert } = await loadReceiver(store)
    const rawSecret = 'ghp_1234567890abcdef' // ghp_ + 16 chars — matches SECRET_VALUE_PATTERNS

    await handleIncomingAlert({
      alerts: [
        baseAlert({
          annotations: {
            summary: `Leaked token in logs: ${rawSecret}`,
            description: `see also nested.deep.value: ${rawSecret}`,
            nested: { deep: { value: `token=${rawSecret}` } },
          },
        }),
      ],
    })

    const row = [...store.rows.values()][0]
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain(rawSecret)
    expect(row.summary).not.toContain(rawSecret)
    // Prove the scrub reached the NESTED annotations object, not just top-level strings.
    expect(JSON.stringify(row.payload)).not.toContain(rawSecret)
    expect(JSON.stringify(row.payload)).toContain('[REDACTED]')
  })

  it('an alert for installation A never produces a row readable under installation B', async () => {
    const store = makeFakeIncidentStore()
    const { handleIncomingAlert } = await loadReceiver(store)

    await handleIncomingAlert({
      alerts: [baseAlert({ labels: { alertname: 'AreteReviewErrorRate', severity: 'critical', installationId: 'inst-a' }, fingerprint: 'fp-shared' })],
    })

    // Same fingerprint, different installation — must land on its own row, and
    // installation A's row must not be reachable under installation B's key.
    const crossTenantLookup = await store.incident.findUnique({
      where: { installationId_fingerprint: { installationId: 'inst-b', fingerprint: 'fp-shared' } },
    })
    expect(crossTenantLookup).toBeNull()

    await handleIncomingAlert({
      alerts: [baseAlert({ labels: { alertname: 'AreteReviewErrorRate', severity: 'critical', installationId: 'inst-b' }, fingerprint: 'fp-shared' })],
    })

    expect(store.rows.size).toBe(2)
    const rowA = await store.incident.findUnique({
      where: { installationId_fingerprint: { installationId: 'inst-a', fingerprint: 'fp-shared' } },
    })
    const rowB = await store.incident.findUnique({
      where: { installationId_fingerprint: { installationId: 'inst-b', fingerprint: 'fp-shared' } },
    })
    expect(rowA).not.toBeNull()
    expect(rowB).not.toBeNull()
    expect(rowA!.id).not.toBe(rowB!.id)
  })

  it('drops a malformed alert (missing installationId/alertname/fingerprint) without throwing and without persisting', async () => {
    const store = makeFakeIncidentStore()
    const { handleIncomingAlert } = await loadReceiver(store)

    const result = await handleIncomingAlert({
      alerts: [{ status: 'firing', labels: { severity: 'critical' }, annotations: {} }],
    })

    expect(result).toEqual({ created: 0, updated: 0 })
    expect(store.rows.size).toBe(0)
  })

  it('never throws on a garbage/non-object body — returns zero counts', async () => {
    const store = makeFakeIncidentStore()
    const { handleIncomingAlert } = await loadReceiver(store)

    await expect(handleIncomingAlert(null)).resolves.toEqual({ created: 0, updated: 0 })
    await expect(handleIncomingAlert('not an object')).resolves.toEqual({ created: 0, updated: 0 })
    await expect(handleIncomingAlert({})).resolves.toEqual({ created: 0, updated: 0 })
    await expect(handleIncomingAlert({ alerts: 'not-an-array' })).resolves.toEqual({ created: 0, updated: 0 })
  })
})
