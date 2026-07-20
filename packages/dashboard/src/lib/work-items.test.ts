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

  it('carries the honest fixError through to the view (healing loop §7)', async () => {
    const { db } = fakeDb([row({ id: 'wi-9', state: 'open', fixError: 'timeout' })]);

    const inbox = await getWorkItemInbox(db, ['inst-1']);

    expect(inbox.items[0].fixError).toBe('timeout');
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
