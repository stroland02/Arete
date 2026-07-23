import { describe, expect, it, vi } from 'vitest'
import {
  collectFixSignals,
  MAX_SIGNAL_LOGS,
  MAX_SIGNAL_SPANS,
  MAX_LOG_BODY_CHARS,
  type CollectFixSignalsDeps,
} from './incident-signals.js'

const WORK_ITEM_ID = 'wi-1'
const INSTALLATION_ID = 'inst-platform'

const INCIDENT = {
  id: 'inc-1',
  alertName: 'AreteReviewErrorRate',
  severity: 'critical',
  status: 'firing',
  summary: 'Review error rate above 10% for 10m',
  payload: { labels: { alertname: 'AreteReviewErrorRate', service: 'arete-webhook' } },
  startsAt: new Date('2026-07-22T10:00:00.000Z'),
  resolvedAt: null,
}

function granted(overrides: Record<string, unknown> = {}) {
  return {
    access: 'granted' as const,
    spans: [],
    logs: [],
    exceptions: [],
    unavailable: false,
    ...overrides,
  }
}

function deps(overrides: Partial<CollectFixSignalsDeps> = {}): CollectFixSignalsDeps {
  return {
    prisma: { incident: { findFirst: vi.fn().mockResolvedValue(INCIDENT) } },
    db: {} as never,
    getSignals: vi.fn().mockResolvedValue(granted()),
    ...overrides,
  }
}

describe('collectFixSignals', () => {
  it('returns null when no incident opened the work item, without querying telemetry', async () => {
    // The overwhelmingly common case: a scan-born work item. A fix drive for it
    // must cost nothing extra and must not imply an incident context exists.
    const getSignals = vi.fn()
    const d = deps({
      prisma: { incident: { findFirst: vi.fn().mockResolvedValue(null) } },
      getSignals,
    })

    expect(
      await collectFixSignals(d, { workItemId: WORK_ITEM_ID, installationId: INSTALLATION_ID })
    ).toBeNull()
    expect(getSignals).not.toHaveBeenCalled()
  })

  it('looks the incident up by work item AND installation, never by work item alone', async () => {
    // Tenancy: Incident.workItemId is a denormalized field with no relation, so
    // nothing in the schema stops a lookup from crossing installations. The
    // scope has to be in the query.
    const findFirst = vi.fn().mockResolvedValue(INCIDENT)
    await collectFixSignals(deps({ prisma: { incident: { findFirst } } }), {
      workItemId: WORK_ITEM_ID,
      installationId: INSTALLATION_ID,
    })

    const where = findFirst.mock.calls[0]![0].where
    expect(where).toMatchObject({ workItemId: WORK_ITEM_ID, installationId: INSTALLATION_ID })
  })

  it('scopes telemetry to the alert service label and the incident window', async () => {
    const getSignals = vi.fn().mockResolvedValue(granted())
    await collectFixSignals(deps({ getSignals }), {
      workItemId: WORK_ITEM_ID,
      installationId: INSTALLATION_ID,
    })

    const [, installationIds, window, service] = getSignals.mock.calls[0]!
    expect(installationIds).toEqual([INSTALLATION_ID])
    expect(service).toBe('arete-webhook')
    // 15 minutes before the alert fired, per incidentSignalWindow.
    expect(window.start.toISOString()).toBe('2026-07-22T09:45:00.000Z')
    expect(window.end.getTime()).toBeGreaterThan(window.start.getTime())
  })

  it('falls back to the `job` label when the payload names no `service`', async () => {
    const getSignals = vi.fn().mockResolvedValue(granted())
    await collectFixSignals(
      deps({
        prisma: {
          incident: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ ...INCIDENT, payload: { labels: { job: 'arete-worker' } } }),
          },
        },
        getSignals,
      }),
      { workItemId: WORK_ITEM_ID, installationId: INSTALLATION_ID }
    )

    expect(getSignals.mock.calls[0]![3]).toBe('arete-worker')
  })

  it('reports a denied platform gate as denied — never as "no signals"', async () => {
    // The §4 distinction, carried to the agent: "you may not look" must not
    // reach the fix prompt as "nothing was wrong".
    const result = await collectFixSignals(
      deps({ getSignals: vi.fn().mockResolvedValue({ ...granted(), access: 'denied' }) }),
      { workItemId: WORK_ITEM_ID, installationId: INSTALLATION_ID }
    )

    expect(result!.availability).toBe('denied')
  })

  it('reports a telemetry backend outage as unavailable, distinctly from denied', async () => {
    const result = await collectFixSignals(
      deps({ getSignals: vi.fn().mockResolvedValue({ ...granted(), unavailable: true }) }),
      { workItemId: WORK_ITEM_ID, installationId: INSTALLATION_ID }
    )

    expect(result!.availability).toBe('unavailable')
  })

  it('reports a genuinely empty window as granted with no signals', async () => {
    const result = await collectFixSignals(deps(), {
      workItemId: WORK_ITEM_ID,
      installationId: INSTALLATION_ID,
    })

    expect(result!.availability).toBe('granted')
    expect(result!.spans).toEqual([])
    expect(result!.omitted).toEqual({ spans: 0, logs: 0, exceptions: 0 })
  })

  it('never throws — a telemetry failure degrades the fix, it does not fail it', async () => {
    // Global Constraint 3: telemetry must never take the app down. A fix drive
    // has already minted a token and checked out a repo by this point.
    const result = await collectFixSignals(
      deps({ getSignals: vi.fn().mockRejectedValue(new Error('clickhouse exploded')) }),
      { workItemId: WORK_ITEM_ID, installationId: INSTALLATION_ID }
    )

    expect(result!.availability).toBe('unavailable')
    expect(result!.spans).toEqual([])
  })

  it('returns null rather than throwing when the incident lookup itself fails', async () => {
    const result = await collectFixSignals(
      deps({ prisma: { incident: { findFirst: vi.fn().mockRejectedValue(new Error('db down')) } } }),
      { workItemId: WORK_ITEM_ID, installationId: INSTALLATION_ID }
    )

    expect(result).toBeNull()
  })

  it('caps what reaches the prompt and reports exactly how much it dropped', async () => {
    // A silent cap reads as "this is everything". The agent has to know the
    // sample was truncated, or it will reason as if it saw the whole window.
    const span = {
      timestamp: new Date('2026-07-22T10:01:00.000Z'),
      service: 'arete-webhook',
      spanName: 'review.run',
      traceId: 'abc',
      statusMessage: 'boom',
      durationMs: 12,
    }
    const logLine = {
      timestamp: new Date('2026-07-22T10:01:00.000Z'),
      service: 'arete-webhook',
      severity: 'ERROR',
      body: 'x'.repeat(MAX_LOG_BODY_CHARS + 250),
      traceId: 'abc',
    }
    const result = await collectFixSignals(
      deps({
        getSignals: vi.fn().mockResolvedValue(
          granted({
            spans: Array.from({ length: MAX_SIGNAL_SPANS + 7 }, () => span),
            logs: Array.from({ length: MAX_SIGNAL_LOGS + 3 }, () => logLine),
          })
        ),
      }),
      { workItemId: WORK_ITEM_ID, installationId: INSTALLATION_ID }
    )

    expect(result!.spans).toHaveLength(MAX_SIGNAL_SPANS)
    expect(result!.logs).toHaveLength(MAX_SIGNAL_LOGS)
    expect(result!.omitted.spans).toBe(7)
    expect(result!.omitted.logs).toBe(3)
    // Long bodies are truncated visibly, not silently clipped.
    expect(result!.logs[0]!.body.length).toBeLessThanOrEqual(MAX_LOG_BODY_CHARS + 1)
    expect(result!.logs[0]!.body.endsWith('…')).toBe(true)
  })

  it('serialises timestamps as ISO strings for the Python wire contract', async () => {
    const result = await collectFixSignals(
      deps({
        getSignals: vi.fn().mockResolvedValue(
          granted({
            exceptions: [
              {
                exceptionType: 'ValueError',
                exceptionMessage: 'bad input',
                service: 'arete-agents',
                occurrences: 3,
                lastSeen: new Date('2026-07-22T10:05:00.000Z'),
              },
            ],
          })
        ),
      }),
      { workItemId: WORK_ITEM_ID, installationId: INSTALLATION_ID }
    )

    expect(result!.startsAt).toBe('2026-07-22T10:00:00.000Z')
    expect(result!.exceptions[0]!.lastSeen).toBe('2026-07-22T10:05:00.000Z')
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
