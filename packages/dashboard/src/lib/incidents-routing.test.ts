/**
 * Stage 3.2 — a manual investigation can now start a fix.
 *
 * The property these pin is not "it calls the webhook" but "it never claims
 * more than the webhook said". A refusal, an unconfigured webhook and an
 * unreachable one are three different facts, and collapsing any of them into
 * either a success or a thrown error would misreport what happened to an
 * incident the user can already see was created.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./internal-auth', () => ({
  internalAuthHeaders: async () => ({ authorization: 'Bearer test-token' }),
}));

import { requestIncidentRouting } from './incidents';

const ORIGINAL_URL = process.env.WEBHOOK_SERVICE_URL;

function mockFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl as never);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const jsonRes = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: async () => body } as never);

beforeEach(() => {
  process.env.WEBHOOK_SERVICE_URL = 'http://webhook.test';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_URL === undefined) delete process.env.WEBHOOK_SERVICE_URL;
  else process.env.WEBHOOK_SERVICE_URL = ORIGINAL_URL;
});

describe('requestIncidentRouting', () => {
  it('reports a routed incident and carries the work item id back', async () => {
    mockFetch(() => jsonRes({ routed: true, workItemId: 'wi-9' }));

    expect(await requestIncidentRouting('inc-1')).toEqual({ routed: true, workItemId: 'wi-9' });
  });

  it('POSTs to the webhook with the internal auth header, id percent-encoded', async () => {
    const fetchMock = mockFetch(() => jsonRes({ routed: true }));

    await requestIncidentRouting('inc/1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://webhook.test/incidents/inc%2F1/route');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-token');
  });

  it('does not double the slash when WEBHOOK_SERVICE_URL has a trailing one', async () => {
    process.env.WEBHOOK_SERVICE_URL = 'http://webhook.test/';
    const fetchMock = mockFetch(() => jsonRes({ routed: true }));

    await requestIncidentRouting('inc-1');

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'http://webhook.test/incidents/inc-1/route',
    );
  });

  it("passes the router's refusal through verbatim rather than flattening it", async () => {
    // not_critical is the common one: the router opens fixes only for
    // critical+firing, so a `warning` investigation is legitimately declined
    // and the UI must be able to say which reason applied.
    mockFetch(() => jsonRes({ routed: false, reason: 'not_critical' }));

    expect(await requestIncidentRouting('inc-1')).toEqual({ routed: false, reason: 'not_critical' });
  });

  it('reports an already-routed incident as declined, not as a fresh success', async () => {
    mockFetch(() => jsonRes({ routed: false, reason: 'already_routed' }));

    expect(await requestIncidentRouting('inc-1')).toEqual({
      routed: false,
      reason: 'already_routed',
    });
  });

  it('says `unavailable` when WEBHOOK_SERVICE_URL is unset, without calling fetch', async () => {
    delete process.env.WEBHOOK_SERVICE_URL;
    const fetchMock = mockFetch(() => jsonRes({ routed: true }));

    expect(await requestIncidentRouting('inc-1')).toEqual({ routed: false, reason: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says `unavailable` when the webhook is unreachable — never throws', async () => {
    // The incident is already durably created by this point. Throwing would
    // fail the whole action over a record that demonstrably exists.
    mockFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    expect(await requestIncidentRouting('inc-1')).toEqual({ routed: false, reason: 'unavailable' });
  });

  it('treats a non-2xx webhook response as unavailable, not as a refusal', async () => {
    // A 500 means we do not know the router's verdict. Reporting it as a
    // decline would assert a decision that was never made.
    mockFetch(() => jsonRes({ routed: false, reason: 'not_critical' }, false, 500));

    expect(await requestIncidentRouting('inc-1')).toEqual({ routed: false, reason: 'unavailable' });
  });

  it('falls back to `declined` when the body omits a reason', async () => {
    mockFetch(() => jsonRes({ routed: false }));

    expect(await requestIncidentRouting('inc-1')).toEqual({ routed: false, reason: 'declined' });
  });

  it('does not treat a truthy-but-not-true routed value as success', async () => {
    mockFetch(() => jsonRes({ routed: 'yes' }));

    expect(await requestIncidentRouting('inc-1')).toEqual({ routed: false, reason: 'declined' });
  });
});
