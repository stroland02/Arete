import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The authenticated half of endpoint management. The vulnerability being closed
// was an UNAUTHENTICATED route that took its target tenant from the request, so
// what these tests pin is the opposite property: the tenant is derived from the
// session, a client-supplied installationId is refused unless the session owns
// it, and a refusal never reaches the webhook service at all.

const requireScopeMock = vi.fn();
vi.mock('@/lib/model-connections-api', () => ({
  requireScope: (...a: unknown[]) => requireScopeMock(...a),
}));
vi.mock('@/lib/internal-auth', () => ({
  internalAuthHeaders: async () => ({ authorization: 'Bearer test-internal-token' }),
}));

import {
  listEndpointsForSession,
  createEndpointForSession,
  setEndpointEnabledForSession,
} from './webhook-endpoints-api';

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

function upstream(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  requireScopeMock.mockReset();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as never;
  process.env.WEBHOOK_SERVICE_URL = 'http://webhook.internal';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.WEBHOOK_SERVICE_URL;
});

describe('unauthenticated callers', () => {
  it('are refused on every path, and nothing is proxied upstream', async () => {
    requireScopeMock.mockResolvedValue(null);

    const list = await listEndpointsForSession();
    const create = await createEndpointForSession({
      installationId: 'inst-1',
      url: 'https://example.test/hook',
      events: ['review.created'],
    });
    const toggle = await setEndpointEnabledForSession({
      installationId: 'inst-1',
      id: 'ep-1',
      enabled: false,
    });

    for (const result of [list, create, toggle]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('cross-tenant attempts', () => {
  // THE ORIGINAL VULNERABILITY, in its authenticated form: a signed-in user
  // naming somebody else's installation.
  it('refuses a create for an installation the session does not own, without calling upstream', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-mine'], userId: 'u1' });

    const result = await createEndpointForSession({
      installationId: 'inst-victim',
      url: 'https://attacker.test/hook',
      events: ['review.created'],
    });

    expect(result.ok).toBe(false);
    // 404, never 403 — a 403 would confirm the victim installation exists.
    if (!result.ok) expect(result.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a toggle for an installation the session does not own, without calling upstream', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-mine'], userId: 'u1' });

    const result = await setEndpointEnabledForSession({
      installationId: 'inst-victim',
      id: 'ep-victim',
      enabled: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('listEndpointsForSession', () => {
  it("queries ONLY the session's own installations", async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-a', 'inst-b'], userId: 'u1' });
    fetchMock.mockResolvedValue(upstream(200, { ok: true, endpoints: [] }));

    await listEndpointsForSession();

    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls).toHaveLength(2);
    expect(calledUrls[0]).toContain('installationId=inst-a');
    expect(calledUrls[1]).toContain('installationId=inst-b');
  });

  it('returns endpoints with no signing secret anywhere in the payload', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-a'], userId: 'u1' });
    fetchMock.mockResolvedValue(
      upstream(200, {
        ok: true,
        endpoints: [
          {
            id: 'ep-1',
            installationId: 'inst-a',
            url: 'https://example.test/hook',
            events: ['review.created'],
            enabled: true,
          },
        ],
      }),
    );

    const result = await listEndpointsForSession();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.data)).not.toContain('whsec_');
    expect(result.data[0]).not.toHaveProperty('secret');
  });

  it('reports an unreachable webhook service rather than an empty list', async () => {
    // An empty list would read as "you have no destinations", which is a lie
    // when the truth is "we could not ask".
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-a'], userId: 'u1' });
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const result = await listEndpointsForSession();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
  });
});

describe('createEndpointForSession', () => {
  it('returns the one-time secret for an installation the session owns', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-a'], userId: 'u1' });
    fetchMock.mockResolvedValue(
      upstream(201, {
        ok: true,
        endpoint: {
          id: 'ep-1',
          installationId: 'inst-a',
          url: 'https://example.test/hook',
          events: ['review.created'],
          enabled: true,
        },
        secret: 'whsec_test-secret',
      }),
    );

    const result = await createEndpointForSession({
      installationId: 'inst-a',
      url: 'https://example.test/hook',
      events: ['review.created'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.secret).toBe('whsec_test-secret');
    expect(result.data.endpoint).not.toHaveProperty('secret');
  });

  it('surfaces an SSRF rejection from the webhook service as a 400', async () => {
    requireScopeMock.mockResolvedValue({ installationIds: ['inst-a'], userId: 'u1' });
    fetchMock.mockResolvedValue(
      upstream(400, {
        ok: false,
        reason: 'invalid_url',
        detail: 'destination resolves to a private address',
      }),
    );

    const result = await createEndpointForSession({
      installationId: 'inst-a',
      url: 'http://169.254.169.254/latest/meta-data',
      events: ['review.created'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: 'invalid_url' });
  });
});
