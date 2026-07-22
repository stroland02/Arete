import { describe, it, expect, vi } from 'vitest';
import { getIncidents, getIncidentDetail, createManualIncident } from './incidents';

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

function fakeMutationsDb(repo: { fullName: string } | null = { fullName: 'acme/api' }) {
  const incidentCreate = vi.fn().mockResolvedValue({ id: 'inc-new' });
  const incidentUpdate = vi.fn().mockResolvedValue({});
  const workItemCreate = vi.fn().mockResolvedValue({ id: 'wi-new-1234567' });
  const workItemUpdate = vi.fn().mockResolvedValue({});
  const repositoryFindFirst = vi.fn().mockResolvedValue(repo);
  const issueContainerCreate = vi.fn().mockResolvedValue({ id: 'cont-new' });
  const db = {
    incident: { create: incidentCreate, update: incidentUpdate },
    workItem: { create: workItemCreate, update: workItemUpdate },
    repository: { findFirst: repositoryFindFirst },
    issueContainer: { create: issueContainerCreate },
  };
  return {
    db: db as never,
    incidentCreate,
    incidentUpdate,
    workItemCreate,
    workItemUpdate,
    repositoryFindFirst,
    issueContainerCreate,
  };
}

describe('createManualIncident', () => {
  const input = { alertName: 'Checkout latency', severity: 'critical', summary: 'p99 climbing' };

  it('records the incident as a firing, manual investigation', async () => {
    const { db, incidentCreate } = fakeMutationsDb();

    await createManualIncident(db, 'inst-1', input);

    expect(incidentCreate.mock.calls[0][0].data).toMatchObject({
      installationId: 'inst-1',
      alertName: 'Checkout latency',
      severity: 'critical',
      status: 'firing',
      summary: 'p99 climbing',
      source: 'manual',
    });
  });

  // THE DEAD END THIS FUNCTION EXISTS TO CLOSE: an Incident row on its own is
  // inert — only a WorkItem enters the fix pipeline. Without this, a
  // hand-opened investigation could never be driven to a fix at all.
  it('opens a WorkItem for the investigation and links it back to the incident', async () => {
    const { db, workItemCreate, incidentUpdate } = fakeMutationsDb();

    const result = await createManualIncident(db, 'inst-1', input);

    expect(result.incidentId).toBe('inc-new');
    expect(result.workItemId).toBe('wi-new-1234567');
    expect(workItemCreate.mock.calls[0][0].data).toMatchObject({
      installationId: 'inst-1',
      source: 'manual',
      title: 'Checkout latency',
      detail: 'p99 climbing',
      state: 'open',
      evidence: [],
    });
    expect(incidentUpdate).toHaveBeenCalledWith({
      where: { id: 'inc-new' },
      data: { workItemId: 'wi-new-1234567' },
    });
  });

  it("namespaces the WorkItem fingerprint to the incident's own, so it cannot collide with a scan-born item", async () => {
    const { db, incidentCreate, workItemCreate } = fakeMutationsDb();

    await createManualIncident(db, 'inst-1', input);

    const incidentFingerprint = incidentCreate.mock.calls[0][0].data.fingerprint;
    expect(incidentFingerprint).toMatch(/^manual-/);
    expect(workItemCreate.mock.calls[0][0].data.fingerprint).toBe(`incident:${incidentFingerprint}`);
  });

  it('auto-starts the fix run: opens an UNAPPROVED container and flips the item to fixing', async () => {
    const { db, issueContainerCreate, workItemUpdate } = fakeMutationsDb();

    const result = await createManualIncident(db, 'inst-1', input);

    expect(result.containerId).toBe('cont-new');
    const container = issueContainerCreate.mock.calls[0][0].data;
    expect(container.state).toBe('detecting');
    // HITL: auto-start begins AUTHORING a patch; it must never pre-approve one.
    expect(container.gates).toEqual({ solutionApprovedAt: null });
    expect(container.target).toEqual({ owner: 'acme', repo: 'api' });
    expect(workItemUpdate).toHaveBeenCalledWith({
      where: { id: 'wi-new-1234567' },
      data: { state: 'fixing', containerId: 'cont-new' },
    });
  });

  it('still opens the WorkItem, but starts no run, when the tenant has no connected repository', async () => {
    const { db, workItemCreate, issueContainerCreate, workItemUpdate } = fakeMutationsDb(null);

    const result = await createManualIncident(db, 'inst-1', input);

    expect(result.workItemId).toBe('wi-new-1234567');
    expect(result.containerId).toBeNull();
    // The investigation is still healable later — the item exists and is `open`
    // for a "Fix it" once a repository is connected.
    expect(workItemCreate).toHaveBeenCalled();
    expect(issueContainerCreate).not.toHaveBeenCalled();
    expect(workItemUpdate).not.toHaveBeenCalled();
  });
});
