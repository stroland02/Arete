import { describe, it, expect, vi } from 'vitest';
import { getIncidents, getIncidentDetail } from './incidents';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    installationId: 'inst-1',
    fingerprint: 'fp-1',
    alertName: 'HighErrorRate',
    severity: 'critical',
    status: 'firing',
    summary: 'Error rate exceeded 5% for 10 minutes',
    startsAt: new Date('2026-07-21T10:00:00Z'),
    resolvedAt: null,
    workItemId: null,
    ...overrides,
  };
}

function fakeDb(incidents: unknown[] = [], workItems: unknown[] = []) {
  const incidentFindMany = vi.fn().mockResolvedValue(incidents);
  const workItemFindMany = vi.fn().mockResolvedValue(workItems);
  const db = {
    incident: { findMany: incidentFindMany },
    workItem: { findMany: workItemFindMany },
  };
  return { db: db as never, incidentFindMany, workItemFindMany };
}

describe('getIncidents', () => {
  it('scopes the incident query to the caller installations', async () => {
    const { db, incidentFindMany } = fakeDb([row()]);

    const incidents = await getIncidents(db, ['inst-1', 'inst-2']);

    expect(incidentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { installationId: { in: ['inst-1', 'inst-2'] } } }),
    );
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      id: 'inc-1',
      alertName: 'HighErrorRate',
      severity: 'critical',
      status: 'firing',
      summary: 'Error rate exceeded 5% for 10 minutes',
      startsAt: '2026-07-21T10:00:00.000Z',
      resolvedAt: null,
      workItemId: null,
      fixContainerId: null,
    });
  });

  it('returns [] without touching the db when the caller has no installations', async () => {
    const { db, incidentFindMany, workItemFindMany } = fakeDb();

    const incidents = await getIncidents(db, []);

    expect(incidents).toEqual([]);
    expect(incidentFindMany).not.toHaveBeenCalled();
    expect(workItemFindMany).not.toHaveBeenCalled();
  });

  it("resolves the linked WorkItem's containerId for the fix-run link, scoped to the same installations", async () => {
    const { db, workItemFindMany } = fakeDb(
      [row({ workItemId: 'wi-1' })],
      [{ id: 'wi-1', containerId: 'container-9' }],
    );

    const incidents = await getIncidents(db, ['inst-1']);

    expect(workItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['wi-1'] }, installationId: { in: ['inst-1'] } },
      }),
    );
    expect(incidents[0].workItemId).toBe('wi-1');
    expect(incidents[0].fixContainerId).toBe('container-9');
  });

  it('leaves fixContainerId null when the linked WorkItem has not opened a container yet', async () => {
    const { db } = fakeDb([row({ workItemId: 'wi-2' })], [{ id: 'wi-2', containerId: null }]);

    const incidents = await getIncidents(db, ['inst-1']);

    expect(incidents[0].workItemId).toBe('wi-2');
    expect(incidents[0].fixContainerId).toBeNull();
  });

  it('never surfaces an incident from another installation (tenancy)', async () => {
    // A real Prisma call scopes via WHERE installationId IN (...); this fake
    // performs that same filter so the assertion pins the query's tenancy
    // contract rather than merely asserting the shape of the call.
    const incidentFindMany = vi.fn().mockImplementation(
      async ({ where }: { where: { installationId: { in: string[] } } }) => {
        const all = [
          row({ id: 'inc-1', installationId: 'inst-1' }),
          row({ id: 'inc-2', installationId: 'inst-2' }),
        ];
        return all.filter((r) => where.installationId.in.includes(r.installationId as string));
      },
    );
    const db = {
      incident: { findMany: incidentFindMany },
      workItem: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;

    const incidents = await getIncidents(db, ['inst-1']);

    expect(incidents.map((i) => i.id)).toEqual(['inc-1']);
  });
});

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    installationId: 'inst-1',
    fingerprint: 'fp-1',
    alertName: 'HighErrorRate',
    severity: 'critical',
    status: 'firing',
    summary: 'Error rate exceeded 5% for 10 minutes',
    payload: { labels: { alertname: 'HighErrorRate' }, annotations: { summary: 'boom' } },
    startsAt: new Date('2026-07-21T10:00:00Z'),
    resolvedAt: null,
    workItemId: null,
    ...overrides,
  };
}

function fakeDetailDb(incidents: Record<string, unknown>[], workItems: Record<string, unknown>[] = []) {
  const incidentFindFirst = vi.fn().mockImplementation(
    async ({ where }: { where: { id: string; installationId: { in: string[] } } }) => {
      return (
        incidents.find(
          (r) =>
            r.id === where.id &&
            where.installationId.in.includes(r.installationId as string),
        ) ?? null
      );
    },
  );
  const workItemFindFirst = vi.fn().mockImplementation(
    async ({ where }: { where: { id: string; installationId: { in: string[] } } }) => {
      return (
        workItems.find(
          (r) =>
            r.id === where.id &&
            where.installationId.in.includes(r.installationId as string),
        ) ?? null
      );
    },
  );
  const db = {
    incident: { findFirst: incidentFindFirst },
    workItem: { findFirst: workItemFindFirst },
  };
  return { db: db as never, incidentFindFirst, workItemFindFirst };
}

describe('getIncidentDetail', () => {
  it('returns the incident detail for an in-scope id', async () => {
    const { db } = fakeDetailDb([detailRow()]);

    const detail = await getIncidentDetail(db, ['inst-1'], 'inc-1');

    expect(detail).toMatchObject({
      id: 'inc-1',
      alertName: 'HighErrorRate',
      severity: 'critical',
      status: 'firing',
      summary: 'Error rate exceeded 5% for 10 minutes',
      startsAt: '2026-07-21T10:00:00.000Z',
      resolvedAt: null,
      payload: { labels: { alertname: 'HighErrorRate' }, annotations: { summary: 'boom' } },
      workItemId: null,
      fixContainerId: null,
    });
  });

  // Cross-tenant probe (Global Constraint 4): the SAME id, but the row
  // belongs to an installation the caller was not granted — must return
  // null, indistinguishable from a genuinely missing id. This is the
  // security-critical assertion for this task.
  it('returns null for the same id when it belongs to a different installation (cross-tenant probe)', async () => {
    const { db } = fakeDetailDb([detailRow({ id: 'inc-1', installationId: 'inst-OTHER' })]);

    const detail = await getIncidentDetail(db, ['inst-1'], 'inc-1');

    expect(detail).toBeNull();
  });

  it('returns null for a genuinely missing id, same shape as the cross-tenant case', async () => {
    const { db } = fakeDetailDb([]);

    const detail = await getIncidentDetail(db, ['inst-1'], 'does-not-exist');

    expect(detail).toBeNull();
  });

  it('returns [] worth of installations => null without touching the db when the caller has no installations', async () => {
    const { db, incidentFindFirst, workItemFindFirst } = fakeDetailDb([detailRow()]);

    const detail = await getIncidentDetail(db, [], 'inc-1');

    expect(detail).toBeNull();
    expect(incidentFindFirst).not.toHaveBeenCalled();
    expect(workItemFindFirst).not.toHaveBeenCalled();
  });

  it("resolves the linked WorkItem's containerId for the fix-run link, scoped to the same installations", async () => {
    const { db, workItemFindFirst } = fakeDetailDb(
      [detailRow({ workItemId: 'wi-1' })],
      [{ id: 'wi-1', installationId: 'inst-1', containerId: 'container-9' }],
    );

    const detail = await getIncidentDetail(db, ['inst-1'], 'inc-1');

    expect(workItemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wi-1', installationId: { in: ['inst-1'] } },
      }),
    );
    expect(detail?.workItemId).toBe('wi-1');
    expect(detail?.fixContainerId).toBe('container-9');
  });

  it('leaves fixContainerId null when the linked WorkItem has not opened a container yet', async () => {
    const { db } = fakeDetailDb(
      [detailRow({ workItemId: 'wi-2' })],
      [{ id: 'wi-2', installationId: 'inst-1', containerId: null }],
    );

    const detail = await getIncidentDetail(db, ['inst-1'], 'inc-1');

    expect(detail?.workItemId).toBe('wi-2');
    expect(detail?.fixContainerId).toBeNull();
  });
});
