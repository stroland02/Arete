import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const requireScopeMock = vi.fn();
const probeMock = vi.fn();
vi.mock('@/lib/model-connections-api', () => ({
  requireScope: (...a: any[]) => requireScopeMock(...a),
  probeModelConnection: (...a: any[]) => probeMock(...a),
  toView: (row: any) => ({ id: row.id, provider: row.provider, model: row.model }),
  classifyTestOutcome: () => ({ status: 401, body: { ok: false, detail: 'invalid key' } }),
}));

const upsert = vi.fn();
const findMany = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    modelConnection: {
      upsert: (...a: any[]) => upsert(...a),
      findMany: (...a: any[]) => findMany(...a),
    },
  },
}));

vi.mock('@/lib/internal-auth', () => ({ internalAuthHeaders: async () => ({ 'x-internal': 't' }) }));
vi.mock('@/lib/telemetry-credentials', () => ({ encryptCredentials: (c: unknown) => `enc:${JSON.stringify(c)}` }));

import { GET, POST } from './route';

const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));

function post(body: Record<string, unknown>) {
  return new Request('http://localhost/api/model-connections', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  requireScopeMock.mockReset();
  probeMock.mockReset();
  upsert.mockReset();
  findMany.mockReset();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  process.env.WEBHOOK_SERVICE_URL = 'http://webhook:3001';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WEBHOOK_SERVICE_URL;
});

describe('POST /api/model-connections — pending (zero installations)', () => {
  it('persists a user-scoped pending row (no 403) and does NOT fire the scan trigger', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: [], userId: 'user-1' });
    probeMock.mockResolvedValue({ ok: true });
    upsert.mockResolvedValue({ id: 'mc-1', provider: 'anthropic', model: 'claude' });

    const res = await POST(post({ provider: 'anthropic', model: 'claude', apiKey: 'sk-good' }));

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_provider: { userId: 'user-1', provider: 'anthropic' } },
        create: expect.objectContaining({ userId: 'user-1', installationId: null }),
      }),
    );
    // Nothing to scan without a repo — the trigger must not fire.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still probes first: a bad key never persists (validate-then-write)', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: [], userId: 'user-1' });
    probeMock.mockResolvedValue({ ok: false, detail: 'invalid key' });

    const res = await POST(post({ provider: 'anthropic', model: 'claude', apiKey: 'sk-bad' }));

    expect(res.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/model-connections — with installations (unchanged)', () => {
  it('upserts on installationId_provider and fires the scan trigger', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-1'], userId: 'user-1' });
    probeMock.mockResolvedValue({ ok: true });
    upsert.mockResolvedValue({ id: 'mc-1', provider: 'anthropic', model: 'claude' });

    const res = await POST(post({ provider: 'anthropic', model: 'claude', apiKey: 'sk-good' }));

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { installationId_provider: { installationId: 'inst-1', provider: 'anthropic' } },
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://webhook:3001/scan/trigger',
      expect.objectContaining({ body: JSON.stringify({ installationId: 'inst-1' }) }),
    );
  });

  it('401 when unauthenticated', async () => {
    requireScopeMock.mockResolvedValue(null);
    const res = await POST(post({ provider: 'anthropic', model: 'claude' }));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/model-connections', () => {
  it('lists installation rows AND the caller\'s pending rows (OR scope)', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-1'], userId: 'user-1' });
    findMany.mockResolvedValue([{ id: 'mc-1', provider: 'anthropic', model: 'claude' }]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { installationId: { in: ['inst-1'] } },
            { userId: 'user-1', installationId: null },
          ],
        },
      }),
    );
  });
});
