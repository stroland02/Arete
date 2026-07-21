import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireScopeMock = vi.fn();
vi.mock('@/lib/model-connections-api', () => ({ requireScope: (...a: any[]) => requireScopeMock(...a) }));

const workItemFindFirst = vi.fn();
const workItemUpdate = vi.fn();
const repositoryFindFirst = vi.fn();
const issueContainerCreate = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    workItem: {
      findFirst: (...a: any[]) => workItemFindFirst(...a),
      update: (...a: any[]) => workItemUpdate(...a),
    },
    repository: { findFirst: (...a: any[]) => repositoryFindFirst(...a) },
    issueContainer: { create: (...a: any[]) => issueContainerCreate(...a) },
  },
}));

import { POST } from './route';

function req() {
  return new Request('http://localhost/api/work-items/wi-1/fix', { method: 'POST' }) as any;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wi-1',
    installationId: 'inst-1',
    kind: 'issue',
    title: 'SQL from raw input',
    detail: 'reports() passes q into db.raw',
    evidence: [{ path: 'app/api/reports.ts', line: 3 }],
    state: 'open',
    fixFailureCount: 0,
    fixFailureAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  requireScopeMock.mockReset();
  workItemFindFirst.mockReset();
  workItemUpdate.mockReset();
  repositoryFindFirst.mockReset();
  issueContainerCreate.mockReset();
  delete process.env.WEBHOOK_SERVICE_URL;
});

describe('POST /api/work-items/[id]/fix', () => {
  it('401 when unauthenticated', async () => {
    requireScopeMock.mockResolvedValue(null);
    const res = await POST(req(), ctx('wi-1'));
    expect(res.status).toBe(401);
  });

  it('404 for an unknown or cross-tenant item', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-1'] });
    workItemFindFirst.mockResolvedValue(null);
    const res = await POST(req(), ctx('missing'));
    expect(res.status).toBe(404);
  });

  it('409 when the item is not open', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-1'] });
    workItemFindFirst.mockResolvedValue(baseItem({ state: 'fixing' }));
    const res = await POST(req(), ctx('wi-1'));
    expect(res.status).toBe(409);
    expect(issueContainerCreate).not.toHaveBeenCalled();
  });

  it('429 with a Retry-After header when a recent failure is still within its cooldown window', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-1'] });
    workItemFindFirst.mockResolvedValue(baseItem({ fixFailureCount: 1, fixFailureAt: new Date() }));

    const res = await POST(req(), ctx('wi-1'));

    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(issueContainerCreate).not.toHaveBeenCalled();
    expect(workItemUpdate).not.toHaveBeenCalled();
  });

  it('allows a retry once the cooldown window has elapsed', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-1'] });
    const longAgo = new Date(Date.now() - 6 * 60 * 1000); // 6 min > 5 min base window
    workItemFindFirst.mockResolvedValue(baseItem({ fixFailureCount: 1, fixFailureAt: longAgo }));
    repositoryFindFirst.mockResolvedValue({ fullName: 'acme/api' });
    issueContainerCreate.mockResolvedValue({ id: 'cont-1' });
    workItemUpdate.mockResolvedValue({});

    const res = await POST(req(), ctx('wi-1'));

    expect(res.status).toBe(200);
    expect(issueContainerCreate).toHaveBeenCalled();
  });

  it('200 happy path when there is no prior failure', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-1'] });
    workItemFindFirst.mockResolvedValue(baseItem());
    repositoryFindFirst.mockResolvedValue({ fullName: 'acme/api' });
    issueContainerCreate.mockResolvedValue({ id: 'cont-1' });
    workItemUpdate.mockResolvedValue({});

    const res = await POST(req(), ctx('wi-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ containerId: 'cont-1' });
  });
});
