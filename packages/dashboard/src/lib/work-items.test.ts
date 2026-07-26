import { describe, it, expect, vi } from 'vitest';
import { getWorkItemInbox } from './work-items';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wi-1',
    installationId: 'inst-1',
    kind: 'issue',
    source: 'scan',
    title: 'SQL built from raw request input',
    detail: 'reports() passes q straight into db.raw.',
    evidence: [{ path: 'app/api/reports.ts', line: 3, excerpt: 'db.raw(q)' }],
    dimension: 'security',
    confidence: 0.8,
    state: 'open',
    ...overrides,
  };
}

function fakeDb(items: unknown[] = [], lastRun: unknown = null) {
  const workItemFindMany = vi.fn().mockResolvedValue(items);
  const scanRunFindFirst = vi.fn().mockResolvedValue(lastRun);
  const db = {
    workItem: { findMany: workItemFindMany },
    scanRun: { findFirst: scanRunFindFirst },
  };
  return { db: db as never, workItemFindMany, scanRunFindFirst };
}

describe('getWorkItemInbox', () => {
  it('scopes every query to the caller installations and excludes dismissed by default', async () => {
    const { db, workItemFindMany, scanRunFindFirst } = fakeDb([row()]);

    const inbox = await getWorkItemInbox(db, ['inst-1', 'inst-2']);

    expect(workItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          installationId: { in: ['inst-1', 'inst-2'] },
          state: { not: 'dismissed' },
        }),
      }),
    );
    expect(scanRunFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ installationId: { in: ['inst-1', 'inst-2'] } }),
      }),
    );
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      id: 'wi-1',
      kind: 'issue',
      dimension: 'security',
      confidence: 0.8,
      state: 'open',
    });
  });

  it('returns an empty inbox without touching the db when the caller has no installations', async () => {
    const { db, workItemFindMany, scanRunFindFirst } = fakeDb();

    const inbox = await getWorkItemInbox(db, []);

    expect(inbox).toEqual({ items: [], lastScan: null });
    expect(workItemFindMany).not.toHaveBeenCalled();
    expect(scanRunFindFirst).not.toHaveBeenCalled();
  });

  it('surfaces the newest ScanRun (by startedAt desc) as lastScan with a client-safe finishedAt', async () => {
    const { db, scanRunFindFirst } = fakeDb([], {
      id: 'run-9',
      status: 'no_findings',
      error: null,
      finishedAt: new Date('2026-07-17T12:00:00Z'),
    });

    const inbox = await getWorkItemInbox(db, ['inst-1']);

    expect(scanRunFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startedAt: 'desc' } }),
    );
    expect(inbox.lastScan).toEqual({
      status: 'no_findings',
      finishedAt: '2026-07-17T12:00:00.000Z',
      error: null,
    });
  });

  it('passes a failed run error through for the honest "Scan failed" line', async () => {
    const { db } = fakeDb([], {
      id: 'run-9',
      status: 'failed',
      error: 'agents /scan responded 503',
      finishedAt: null,
    });

    const inbox = await getWorkItemInbox(db, ['inst-1']);

    expect(inbox.lastScan).toEqual({
      status: 'failed',
      finishedAt: null,
      error: 'agents /scan responded 503',
    });
  });
});

// Fix-run cooldown (Phase 3 Task 8): the badge/disable state the Services UI
// shows BEFORE the user clicks Fix it, computed with the same pure
// computeFixCooldown the fix API route enforces server-side (fix-cooldown.ts)
// — never re-derived here.
describe('getWorkItemInbox — fix cooldown view state', () => {
  it('yields a "cooling down" fixCooldown with a positive remaining-seconds for a recently-failed item', async () => {
    const { db } = fakeDb([row({ fixFailureCount: 2, fixFailureAt: new Date() })]);

    const inbox = await getWorkItemInbox(db, ['inst-1']);

    expect(inbox.items[0].fixCooldown.allowed).toBe(false);
    expect(inbox.items[0].fixCooldown.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('yields a "ready" fixCooldown for an item with no prior failures', async () => {
    const { db } = fakeDb([row({ fixFailureCount: 0, fixFailureAt: null })]);

    const inbox = await getWorkItemInbox(db, ['inst-1']);

    expect(inbox.items[0].fixCooldown).toEqual({ allowed: true });
  });
});

// containerState decides which human gate the Services panel may offer, so it
// must be read tenant-scoped and must be NULL whenever it isn't genuinely
// known — a wrong state here would render a control the server then refuses.
describe('getWorkItemInbox — linked container state', () => {
  function dbWithContainers(items: unknown[], containers: unknown[] | Error) {
    const findMany = vi.fn(() =>
      containers instanceof Error ? Promise.reject(containers) : Promise.resolve(containers),
    );
    const db = {
      workItem: { findMany: vi.fn().mockResolvedValue(items) },
      scanRun: { findFirst: vi.fn().mockResolvedValue(null) },
      issueContainer: { findMany },
    };
    return { db: db as never, findMany };
  }

  it("maps the linked container's stored state onto the item, scoped to the caller's installations", async () => {
    const { db, findMany } = dbWithContainers(
      [row({ state: 'fixing', containerId: 'cont-7' })],
      [{ id: 'cont-7', pr: null, state: 'ready' }],
    );

    const inbox = await getWorkItemInbox(db, ['inst-1', 'inst-2']);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['cont-7'] },
          installationId: { in: ['inst-1', 'inst-2'] },
        }),
      }),
    );
    expect(inbox.items[0].containerState).toBe('ready');
  });

  it('leaves containerState null when the container read fails — no gate is offered on a guess', async () => {
    const { db } = dbWithContainers(
      [row({ state: 'fixing', containerId: 'cont-7' })],
      new Error('db unavailable'),
    );

    const inbox = await getWorkItemInbox(db, ['inst-1']);

    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0].containerState).toBeNull();
  });

  it('leaves containerState null for an item that never started a fix run', async () => {
    const { db, findMany } = dbWithContainers([row({ state: 'open', containerId: null })], []);

    const inbox = await getWorkItemInbox(db, ['inst-1']);

    expect(findMany).not.toHaveBeenCalled();
    expect(inbox.items[0].containerState).toBeNull();
  });
});
