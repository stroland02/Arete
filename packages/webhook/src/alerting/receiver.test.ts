import { describe, it, expect, vi, beforeEach } from 'vitest'

// handleIncomingAlert is the pure business-logic core behind POST
// /alerts/incoming (route wiring + the auth-rejection mutation test live in
// server.test.ts, matching the split already used for /fix/trigger). These
// tests drive it against a fake prisma store that mimics the real
// (installationId, fingerprint) compound-unique semantics (Task 2's
// @@unique([installationId, fingerprint])) so the idempotency, resolution,
// scrubbing, and attribution behavior can be asserted without a real Postgres.
//
// Tenancy (review fix round 1, finding C1): the receiver NO LONGER reads
// tenancy from the payload. Every alert is attributed to the configured
// platform installation, so a spoofed `installationId` label is structurally
// incapable of steering a row into a customer's tenant. The tests below are
// the mutation tests for that gate (Global Constraint 10).

interface FakeIncidentRow {
  id: string
  installationId: string
  fingerprint: string
  alertName: string
  severity: string
  status: string
  summary: string
  payload: any
  startsAt: Date
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
  workItemId: string | null
}

const PLATFORM_ID = 'inst-platform'

function makeFakeIncidentStore(knownInstallationIds: string[] = [PLATFORM_ID]) {
  const rows = new Map<string, FakeIncidentRow>()
  const known = new Set(knownInstallationIds)
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

  // The receiver validates ARETE_PLATFORM_INSTALLATION_ID against a real
  // Installation row before attributing anything to it (finding I6 — a
  // misconfigured id must be detectable, not swallowed as a generic foreign
  // key error inside the per-alert catch).
  const installation = {
    findUnique: vi.fn(async (args: any) => {
      const id = args.where.id
      return known.has(id) ? { id, owner: 'arete-platform', provider: 'github' } : null
    }),
  }

  return { incident, installation, rows }
}

function baseAlert(overrides: Record<string, unknown> = {}) {
  return {
    status: 'firing',
    labels: {
      alertname: 'AreteReviewErrorRate',
      severity: 'critical',
    },
    annotations: {
      summary: 'Arete review error rate above 10%',
      description: 'more than 10% of runs failed',
    },
    startsAt: '2026-07-21T00:00:00Z',
    fingerprint: 'fp1',
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
  vi.doMock('../db.js', () => ({
    prisma: {
      incident: store.incident,
      installation: store.installation,
      workItem,
      repository,
    },
  }))
  return import('./receiver.js')
}

describe('handleIncomingAlert', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.ARETE_PLATFORM_INSTALLATION_ID = PLATFORM_ID
  })

  // ---------------------------------------------------------------------
  // C1 — tenancy is never taken from the payload.
  // ---------------------------------------------------------------------
  describe('tenancy attribution (review finding C1)', () => {
    it('attributes a platform alert to the configured platform installation', async () => {
      const store = makeFakeIncidentStore()
      const { handleIncomingAlert } = await loadReceiver(store)

      expect(await handleIncomingAlert({ alerts: [baseAlert()] })).toEqual({ created: 1, updated: 0 })
      expect([...store.rows.values()][0]).toMatchObject({ installationId: PLATFORM_ID })
    })

    it('IGNORES a spoofed installationId label — an attacker cannot steer the row into a tenant', async () => {
      const store = makeFakeIncidentStore([PLATFORM_ID, 'inst-victim'])
      const { handleIncomingAlert } = await loadReceiver(store)

      await handleIncomingAlert({
        alerts: [
          baseAlert({
            labels: {
              alertname: 'AreteReviewErrorRate',
              severity: 'critical',
              installationId: 'inst-victim',
            },
          }),
        ],
      })

      expect(store.rows.size).toBe(1)
      const row = [...store.rows.values()][0]
      expect(row.installationId).toBe(PLATFORM_ID)
      expect(row.installationId).not.toBe('inst-victim')
      expect(store.incident.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            installationId_fingerprint: { installationId: PLATFORM_ID, fingerprint: 'fp1' },
          },
        })
      )
    })

    it('collapses two differently-spoofed alerts sharing a fingerprint onto ONE platform row', async () => {
      const store = makeFakeIncidentStore([PLATFORM_ID, 'inst-a', 'inst-b'])
      const { handleIncomingAlert } = await loadReceiver(store)

      await handleIncomingAlert({
        alerts: [
          baseAlert({
            labels: {
              alertname: 'AreteReviewErrorRate',
              severity: 'critical',
              installationId: 'inst-a',
            },
            fingerprint: 'fpshared',
          }),
        ],
      })
      await handleIncomingAlert({
        alerts: [
          baseAlert({
            labels: {
              alertname: 'AreteReviewErrorRate',
              severity: 'critical',
              installationId: 'inst-b',
            },
            fingerprint: 'fpshared',
          }),
        ],
      })

      expect(store.rows.size).toBe(1)
      expect([...store.rows.values()][0].installationId).toBe(PLATFORM_ID)
      // Neither spoofed tenant ever got a row of its own.
      expect(
        await store.incident.findUnique({
          where: { installationId_fingerprint: { installationId: 'inst-a', fingerprint: 'fpshared' } },
        })
      ).toBeNull()
      expect(
        await store.incident.findUnique({
          where: { installationId_fingerprint: { installationId: 'inst-b', fingerprint: 'fpshared' } },
        })
      ).toBeNull()
    })

    it('drops every alert when ARETE_PLATFORM_INSTALLATION_ID is unset — never invents an owner', async () => {
      delete process.env.ARETE_PLATFORM_INSTALLATION_ID
      const store = makeFakeIncidentStore()
      const { handleIncomingAlert } = await loadReceiver(store)

      expect(await handleIncomingAlert({ alerts: [baseAlert()] })).toEqual({ created: 0, updated: 0 })
      expect(store.rows.size).toBe(0)
    })

    it('drops every alert when the configured installation does not exist (finding I6)', async () => {
      process.env.ARETE_PLATFORM_INSTALLATION_ID = 'inst-typo'
      const store = makeFakeIncidentStore([PLATFORM_ID])
      const { handleIncomingAlert } = await loadReceiver(store)

      expect(await handleIncomingAlert({ alerts: [baseAlert()] })).toEqual({ created: 0, updated: 0 })
      expect(store.rows.size).toBe(0)
      expect(store.installation.findUnique).toHaveBeenCalled()
    })
  })

  it('a valid firing alert creates exactly one Incident', async () => {
    const store = makeFakeIncidentStore()
    const { handleIncomingAlert } = await loadReceiver(store)

    const result = await handleIncomingAlert({ alerts: [baseAlert()] })

    expect(result).toEqual({ created: 1, updated: 0 })
    expect(store.rows.size).toBe(1)
    expect([...store.rows.values()][0]).toMatchObject({
      installationId: PLATFORM_ID,
      fingerprint: 'fp1',
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
      alerts: [baseAlert({ status: 'resolved', endsAt: '2026-07-21T01:00:00Z' })],
    })

    expect(resolved).toEqual({ created: 0, updated: 1 })
    const row = [...store.rows.values()][0]
    expect(row.status).toBe('resolved')
    expect(row.resolvedAt).toBeInstanceOf(Date)
    expect(row.resolvedAt?.toISOString()).toBe('2026-07-21T01:00:00.000Z')
  })

  // ---------------------------------------------------------------------
  // M7 — a resolved incident that re-fires opens a NEW cycle.
  // ---------------------------------------------------------------------
  it('a re-firing incident restarts startsAt and preserves the prior cycle (finding M7)', async () => {
    const store = makeFakeIncidentStore()
    const { handleIncomingAlert } = await loadReceiver(store)

    await handleIncomingAlert({ alerts: [baseAlert()] })
    await handleIncomingAlert({
      alerts: [baseAlert({ status: 'resolved', endsAt: '2026-07-21T01:00:00Z' })],
    })
    await handleIncomingAlert({ alerts: [baseAlert({ startsAt: '2026-07-21T05:00:00Z' })] })

    const row = [...store.rows.values()][0]
    expect(row.status).toBe('firing')
    expect(row.resolvedAt).toBeNull()
    // The new cycle's own start, not the first cycle's.
    expect(row.startsAt.toISOString()).toBe('2026-07-21T05:00:00.000Z')
    // …and the closed cycle is not lost.
    expect(row.payload.priorCycles).toEqual([
      { startsAt: '2026-07-21T00:00:00.000Z', resolvedAt: '2026-07-21T01:00:00.000Z' },
    ])
  })

  // ---------------------------------------------------------------------
  // I2 / I5 — every persisted field is scrubbed, not just payload/summary.
  // ---------------------------------------------------------------------
  describe('redaction (review findings I2, I5)', () => {
    const rawSecret = 'ghp_1234567890abcdef' // ghp_ + 16 chars — SECRET_VALUE_PATTERNS

    it('scrubs a secret out of the payload, the summary AND the scalar columns', async () => {
      const store = makeFakeIncidentStore()
      const { handleIncomingAlert } = await loadReceiver(store)

      await handleIncomingAlert({
        alerts: [
          baseAlert({
            labels: {
              alertname: `AreteReviewErrorRate ${rawSecret}`,
              severity: `critical ${rawSecret}`,
            },
            fingerprint: rawSecret,
            annotations: {
              summary: `Leaked token in logs: ${rawSecret}`,
              description: `see also nested.deep.value: ${rawSecret}`,
              nested: { deep: { value: `token=${rawSecret}` } },
            },
          }),
        ],
      })

      const row = [...store.rows.values()][0]
      // The whole row — every scalar column included — must be clean.
      expect(JSON.stringify(row)).not.toContain(rawSecret)
      expect(row.alertName).not.toContain(rawSecret)
      expect(row.severity).not.toContain(rawSecret)
      expect(row.fingerprint).not.toContain(rawSecret)
      expect(row.summary).not.toContain(rawSecret)
      // Prove the scrub reached the NESTED annotations object, not just top-level.
      expect(JSON.stringify(row.payload)).toContain('[REDACTED]')
    })

    it('applies the REDACT_KEYS key blocklist to annotation keys (finding I5)', async () => {
      const store = makeFakeIncidentStore()
      const { handleIncomingAlert } = await loadReceiver(store)

      await handleIncomingAlert({
        alerts: [
          baseAlert({
            annotations: {
              summary: 'boom',
              password: 'hunter2',
              authorization: 'Basic YWxhZGRpbjpvcGVuc2VzYW1l',
              nested: { apiKey: 'not-a-known-shape-but-still-a-key' },
            },
          }),
        ],
      })

      const serialized = JSON.stringify([...store.rows.values()][0])
      expect(serialized).not.toContain('hunter2')
      expect(serialized).not.toContain('YWxhZGRpbjpvcGVuc2VzYW1l')
      expect(serialized).not.toContain('not-a-known-shape-but-still-a-key')
    })

    it('strips URL query strings, including params the value patterns do not know (finding I5)', async () => {
      const store = makeFakeIncidentStore()
      const { handleIncomingAlert } = await loadReceiver(store)

      await handleIncomingAlert({
        alerts: [
          baseAlert({
            annotations: {
              summary: 'https://example.test/y?password=topsecret',
              runbook_url: 'https://example.test/runbook?password=topsecret&x=1',
            },
          }),
        ],
      })

      const row = [...store.rows.values()][0]
      expect(JSON.stringify(row)).not.toContain('topsecret')
      expect(row.summary).not.toContain('topsecret')
    })
  })

  // ---------------------------------------------------------------------
  // I3 — metric dimensions are a closed set (Global Constraint 1).
  // ---------------------------------------------------------------------
  describe('metric dimensions are a closed set (review finding I3)', () => {
    it('buckets an unknown alertName and normalises an unknown severity', async () => {
      const store = makeFakeIncidentStore()
      const mod = await loadReceiver(store)

      expect(mod.metricAlertName('AreteReviewErrorRate')).toBe('AreteReviewErrorRate')
      expect(mod.metricAlertName('AreteReviewLatencyP95')).toBe('AreteReviewLatencyP95')
      expect(mod.metricAlertName('AreteQueueFailureRate')).toBe('AreteQueueFailureRate')
      expect(mod.metricAlertName('attacker-chosen-' + 'x'.repeat(50))).toBe('other')
      expect(mod.metricAlertName('')).toBe('other')

      expect(mod.normaliseSeverity('critical')).toBe('critical')
      expect(mod.normaliseSeverity('CRITICAL')).toBe('critical')
      expect(mod.normaliseSeverity('warning')).toBe('warning')
      expect(mod.normaliseSeverity('info')).toBe('info')
      expect(mod.normaliseSeverity('page-the-ceo')).toBe('warning')
      expect(mod.normaliseSeverity(undefined)).toBe('warning')
    })

    it('persists a normalised severity, never attacker free text', async () => {
      const store = makeFakeIncidentStore()
      const { handleIncomingAlert } = await loadReceiver(store)

      await handleIncomingAlert({
        alerts: [baseAlert({ labels: { alertname: 'Whatever', severity: 'CRITICAL-ish 💥' } })],
      })

      expect([...store.rows.values()][0].severity).toBe('warning')
    })
  })

  it('drops a malformed alert (missing alertname/fingerprint) without throwing and without persisting', async () => {
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
    await expect(handleIncomingAlert({ alerts: 'not-an-array' })).resolves.toEqual({
      created: 0,
      updated: 0,
    })
  })
})
