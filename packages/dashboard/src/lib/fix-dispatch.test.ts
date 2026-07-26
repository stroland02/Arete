import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openFixContainer, dispatchFixTrigger } from './fix-dispatch';

function fakeDb(containerId = 'cont-1') {
  const issueContainerCreate = vi.fn().mockResolvedValue({ id: containerId });
  const workItemUpdate = vi.fn().mockResolvedValue({});
  const db = {
    issueContainer: { create: issueContainerCreate },
    workItem: { update: workItemUpdate },
  };
  return { db: db as never, issueContainerCreate, workItemUpdate };
}

describe('openFixContainer', () => {
  it('opens the container UNAPPROVED at `detecting` and flips the WorkItem to `fixing`', async () => {
    const { db, issueContainerCreate, workItemUpdate } = fakeDb();

    const { containerId } = await openFixContainer(db, {
      installationId: 'inst-1',
      kind: 'error',
      workItemId: 'wi-abcdef1234',
      target: { owner: 'acme', repo: 'api' },
      title: 'boom',
      detail: 'it broke',
      findings: [],
    });

    expect(containerId).toBe('cont-1');
    const created = issueContainerCreate.mock.calls[0][0].data;
    expect(created.state).toBe('detecting');
    // The HITL moat: a brand-new container must never be born pre-approved.
    expect(created.gates).toEqual({ solutionApprovedAt: null });
    expect(created.target).toEqual({ owner: 'acme', repo: 'api' });
    expect(created.pr.branch).toBe('kuma/error-wi-abcde'); // kuma/<kind>-<id8>
    expect(workItemUpdate).toHaveBeenCalledWith({
      where: { id: 'wi-abcdef1234' },
      data: { state: 'fixing', containerId: 'cont-1' },
    });
  });

  it('seeds the container with the findings it is given', async () => {
    const { db, issueContainerCreate } = fakeDb();
    const findings = [{ path: 'a.ts', line: 3 }];

    await openFixContainer(db, {
      installationId: 'inst-1',
      kind: 'issue',
      workItemId: 'wi-1',
      target: { owner: 'acme', repo: 'api' },
      title: 't',
      detail: 'd',
      findings,
    });

    expect(issueContainerCreate.mock.calls[0][0].data.findings).toBe(findings);
  });
});

describe('dispatchFixTrigger', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.WEBHOOK_SERVICE_URL;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('does nothing (no fetch) when WEBHOOK_SERVICE_URL is unset', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as never;

    await dispatchFixTrigger('wi-1');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts { workItemId } to the webhook /fix/trigger when configured', async () => {
    process.env.WEBHOOK_SERVICE_URL = 'http://webhook.internal';
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as never;

    await dispatchFixTrigger('wi-42');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://webhook.internal/fix/trigger');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ workItemId: 'wi-42' });
  });

  it('swallows a dispatch failure — the run already exists and can be retried', async () => {
    process.env.WEBHOOK_SERVICE_URL = 'http://webhook.internal';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as never;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(dispatchFixTrigger('wi-1')).resolves.toBeUndefined();
  });
});
