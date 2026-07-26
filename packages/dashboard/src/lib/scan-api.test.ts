import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyInternalToken } from '@arete/internal-token';

const requireScope = vi.fn();
vi.mock('@/lib/model-connections-api', () => ({
  requireScope: (...args: unknown[]) => requireScope(...args),
}));

import { POST } from '@/app/api/scan/route';

const KEYS = JSON.stringify({ k1: 'a'.repeat(48) });

function webhookReply(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as Response;
}

describe('POST /api/scan — manual re-scan, session-scoped', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('WEBHOOK_SERVICE_URL', 'http://webhook.internal:3000');
    fetchMock.mockReset();
    requireScope.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('401s an unauthenticated caller', async () => {
    requireScope.mockResolvedValue(null);
    const res = await POST(new Request('http://x/api/scan', { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403s a session with no installation', async () => {
    requireScope.mockResolvedValue({ installationIds: [] });
    const res = await POST(new Request('http://x/api/scan', { method: 'POST' }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies to the webhook trigger with the SESSION-derived installation id (202 passthrough)', async () => {
    requireScope.mockResolvedValue({ installationIds: ['inst-1', 'inst-2'] });
    fetchMock.mockResolvedValue(webhookReply(202, { started: true }));
    const res = await POST(
      new Request('http://x/api/scan', {
        method: 'POST',
        // a client-supplied installationId must be ignored, never proxied
        body: JSON.stringify({ installationId: 'someone-elses-tenant' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://webhook.internal:3000/scan/trigger',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ installationId: 'inst-1' }),
      }),
    );
  });

  it('sends a signed internal bearer token when configured', async () => {
    vi.stubEnv('INTERNAL_TOKEN_SIGNING_KEYS', KEYS);
    vi.stubEnv('INTERNAL_TOKEN_ACTIVE_KID', 'k1');
    requireScope.mockResolvedValue({ installationIds: ['inst-1'] });
    fetchMock.mockResolvedValue(webhookReply(202, { started: true }));
    await POST(new Request('http://x/api/scan', { method: 'POST' }));
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    const result = await verifyInternalToken(init.headers.authorization);
    expect(result).toMatchObject({ ok: true, iss: 'arete-dashboard' });
  });

  it('passes through 409 already_running', async () => {
    requireScope.mockResolvedValue({ installationIds: ['inst-1'] });
    fetchMock.mockResolvedValue(
      webhookReply(409, { started: false, reason: 'already_running' }),
    );
    const res = await POST(new Request('http://x/api/scan', { method: 'POST' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ started: false, reason: 'already_running' });
  });

  it('passes through 200 {started:false, reason:"no_model"}', async () => {
    requireScope.mockResolvedValue({ installationIds: ['inst-1'] });
    fetchMock.mockResolvedValue(webhookReply(200, { started: false, reason: 'no_model' }));
    const res = await POST(new Request('http://x/api/scan', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ started: false, reason: 'no_model' });
  });

  it('502s when the trigger service is unreachable, without leaking internals', async () => {
    requireScope.mockResolvedValue({ installationIds: ['inst-1'] });
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.7'));
    const res = await POST(new Request('http://x/api/scan', { method: 'POST' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain('10.0.0.7');
  });
});
