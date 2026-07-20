import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { requireScope, fakeDb } = vi.hoisted(() => {
  const requireScope = vi.fn();
  const fakeDb = {
    workItem: { findFirst: vi.fn(), update: vi.fn() },
    issueContainer: { create: vi.fn(), updateMany: vi.fn() },
    repository: { findFirst: vi.fn() },
  };
  return { requireScope, fakeDb };
});

vi.mock('@/lib/model-connections-api', () => ({
  requireScope: (...args: unknown[]) => requireScope(...args),
}));
vi.mock('@/lib/db', () => ({ db: fakeDb }));

import { POST as fixRoute } from '@/app/api/work-items/[id]/fix/route';
import { POST as dismissRoute } from '@/app/api/work-items/[id]/dismiss/route';

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function openItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wi-12345678abcd',
    installationId: 'inst-1',
    kind: 'issue',
    source: 'scan',
    title: 'SQL built from raw request input',
    detail: 'reports() passes q straight into db.raw.',
    evidence: [{ path: 'app/api/reports.ts', line: 3, excerpt: 'db.raw(q)' }],
    dimension: 'security',
    confidence: 0.8,
    state: 'open',
    containerId: null,
    ...overrides,
  };
}

beforeEach(() => {
  requireScope.mockReset().mockResolvedValue({ installationIds: ['inst-1'] });
  fakeDb.workItem.findFirst.mockReset();
  fakeDb.workItem.update.mockReset().mockResolvedValue({});
  fakeDb.issueContainer.create.mockReset().mockResolvedValue({ id: 'cont-1' });
  fakeDb.issueContainer.updateMany.mockReset().mockResolvedValue({ count: 1 });
  fakeDb.repository.findFirst.mockReset().mockResolvedValue({ fullName: 'acme/shop' });
  // The fix route now dispatches the run to the webhook's /fix/trigger.
  process.env.WEBHOOK_SERVICE_URL = 'http://wh.test';
  process.env.INTERNAL_API_TOKEN = 'tok-internal';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enqueued: true }), { status: 202 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/work-items/[id]/fix', () => {
  it('401s an unauthenticated caller', async () => {
    requireScope.mockResolvedValue(null);
    const res = await fixRoute(new Request('http://x', { method: 'POST' }), ctx('wi-1'));
    expect(res.status).toBe(401);
  });

  it('reads cross-tenant as not-found (404), scoping the lookup to the session installations', async () => {
    fakeDb.workItem.findFirst.mockResolvedValue(null);
    const res = await fixRoute(new Request('http://x', { method: 'POST' }), ctx('wi-other-tenant'));
    expect(res.status).toBe(404);
    expect(fakeDb.workItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'wi-other-tenant',
          installationId: { in: ['inst-1'] },
        }),
      }),
    );
    expect(fakeDb.issueContainer.create).not.toHaveBeenCalled();
  });

  it('409s a fix on a non-open item (dismissed stays dismissed)', async () => {
    fakeDb.workItem.findFirst.mockResolvedValue(openItem({ state: 'dismissed' }));
    const res = await fixRoute(new Request('http://x', { method: 'POST' }), ctx('wi-12345678abcd'));
    expect(res.status).toBe(409);
    expect(fakeDb.issueContainer.create).not.toHaveBeenCalled();
    expect(fakeDb.workItem.update).not.toHaveBeenCalled();
  });

  it('happy path: container born at detecting from the item evidence, item → fixing, run dispatched', async () => {
    fakeDb.workItem.findFirst.mockResolvedValue(openItem());
    const res = await fixRoute(new Request('http://x', { method: 'POST' }), ctx('wi-12345678abcd'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ containerId: 'cont-1' });

    expect(fakeDb.issueContainer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        installationId: 'inst-1',
        state: 'detecting',
        gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
        transcript: [],
        target: { owner: 'acme', repo: 'shop' },
        findings: [{ path: 'app/api/reports.ts', line: 3, excerpt: 'db.raw(q)' }],
        pr: expect.objectContaining({
          title: 'SQL built from raw request input',
          branch: 'kuma/issue-wi-12345',
        }),
      }),
    });
    expect(fakeDb.workItem.update).toHaveBeenCalledWith({
      where: { id: 'wi-12345678abcd' },
      data: { state: 'fixing', containerId: 'cont-1', fixError: null },
    });
  });
});

describe('POST /api/work-items/[id]/fix — healing loop dispatch', () => {
  it('dispatches the bearer-authenticated trigger with ONLY the work-item id', async () => {
    fakeDb.workItem.findFirst.mockResolvedValue(openItem());
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    const res = await fixRoute(new Request('http://x', { method: 'POST' }), ctx('wi-12345678abcd'));
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('http://wh.test/fix/trigger');
    expect(init.headers.authorization).toBe('Bearer tok-internal');
    expect(JSON.parse(init.body)).toEqual({ workItemId: 'wi-12345678abcd' });
  });

  it('reverts honestly when the trigger is unreachable: 502, item open + reason, container fix_failed', async () => {
    fakeDb.workItem.findFirst.mockResolvedValue(openItem());
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const res = await fixRoute(new Request('http://x', { method: 'POST' }), ctx('wi-12345678abcd'));
    expect(res.status).toBe(502);

    expect(fakeDb.issueContainer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cont-1', installationId: 'inst-1' },
        data: expect.objectContaining({ state: 'fix_failed' }),
      }),
    );
    const lastItemUpdate = fakeDb.workItem.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(lastItemUpdate.data.state).toBe('open');
    expect(typeof lastItemUpdate.data.fixError).toBe('string');
  });

  it('a non-202 trigger response also reverts (no phantom fixing items)', async () => {
    fakeDb.workItem.findFirst.mockResolvedValue(openItem());
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));

    const res = await fixRoute(new Request('http://x', { method: 'POST' }), ctx('wi-12345678abcd'));
    expect(res.status).toBe(502);
    const lastItemUpdate = fakeDb.workItem.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(lastItemUpdate.data.state).toBe('open');
  });
});

describe('POST /api/work-items/[id]/dismiss', () => {
  it('dismisses an open item (a decision, persisted)', async () => {
    fakeDb.workItem.findFirst.mockResolvedValue(openItem());
    const res = await dismissRoute(new Request('http://x', { method: 'POST' }), ctx('wi-12345678abcd'));
    expect(res.status).toBe(200);
    expect(fakeDb.workItem.update).toHaveBeenCalledWith({
      where: { id: 'wi-12345678abcd' },
      data: { state: 'dismissed' },
    });
  });

  it('409s dismissing a non-open item and 404s cross-tenant', async () => {
    fakeDb.workItem.findFirst.mockResolvedValue(openItem({ state: 'staged' }));
    const conflict = await dismissRoute(new Request('http://x', { method: 'POST' }), ctx('wi-12345678abcd'));
    expect(conflict.status).toBe(409);

    fakeDb.workItem.findFirst.mockResolvedValue(null);
    const missing = await dismissRoute(new Request('http://x', { method: 'POST' }), ctx('wi-x'));
    expect(missing.status).toBe(404);
    expect(fakeDb.workItem.update).not.toHaveBeenCalled();
  });
});
