/**
 * Regression tests — dispatch-before-ack audit, Phase 2 Task 9.
 *
 * This route's own comment (route.ts:1-20) says the outcome mapping is
 * "honest — the transport contract 1:1, no fabricated success" and that the
 * container advances to `posted` only "on a real open". These tests pin
 * that ordering: the route must AWAIT the real staging send, inspect its
 * outcome, and only THEN (a) advance persisted state and (b) map an honest
 * HTTP status — never the reverse.
 *
 * Step 2 of the Task 9 report inverts this route's order on purpose (moving
 * the persistence write ahead of the outcome check) to prove the
 * "REGRESSION" test below is not vacuous — it is expected to fail under that
 * inversion and pass once reverted. See `.superpowers/sdd/task-9-brief.md`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const issueContainerFindFirst = vi.fn();
const issueContainerUpdateMany = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    issueContainer: {
      findFirst: (...a: unknown[]) => issueContainerFindFirst(...a),
      updateMany: (...a: unknown[]) => issueContainerUpdateMany(...a),
    },
  },
}));

// The real external effect (the PR post) lives behind HttpStagingClient.send.
// Faking only this seam — not the route's own outcome-mapping/persistence
// logic — is what lets these tests pin the route's real ordering.
const stagingSendMock = vi.fn();
vi.mock('@/lib/issue-pipeline/staging-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/issue-pipeline/staging-client')>(
    '@/lib/issue-pipeline/staging-client',
  );
  return {
    ...actual,
    HttpStagingClient: vi.fn().mockImplementation(() => ({
      send: (...a: unknown[]) => stagingSendMock(...a),
    })),
  };
});

import { POST } from './route';

const INSTALLATION_ID = 'inst-1';
const CONTAINER_ID = 'container-1';

function req() {
  return new Request(`http://localhost/api/containers/${CONTAINER_ID}/send`, {
    method: 'POST',
  }) as any;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function approvedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONTAINER_ID,
    installationId: INSTALLATION_ID,
    state: 'solution_approved',
    gates: {
      solutionApprovedAt: '2026-07-20T00:00:00.000Z',
      solutionApprovedBy: 'human@example.com',
      postedAt: null,
      postedBy: null,
    },
    target: { owner: 'o', repo: 'r' },
    pr: { base: 'main', title: 't', body: 'b' },
    patch: [],
    findings: [],
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  issueContainerFindFirst.mockReset();
  issueContainerUpdateMany.mockReset();
  stagingSendMock.mockReset();
  authMock.mockResolvedValue({
    user: { email: 'human@example.com' },
    installations: [{ id: INSTALLATION_ID }],
  });
  issueContainerUpdateMany.mockResolvedValue({ count: 1 });
  process.env.STAGING_SERVICE_URL = 'http://staging.internal';
});

describe('POST /api/containers/[id]/send — dispatch-before-ack', () => {
  it('401 when unauthenticated, and never calls the staging client', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(401);
    expect(stagingSendMock).not.toHaveBeenCalled();
  });

  it('404 when no stored row exists, and never calls the staging client', async () => {
    issueContainerFindFirst.mockResolvedValue(null);
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(404);
    expect(stagingSendMock).not.toHaveBeenCalled();
  });

  it('409 when the STORED state has not cleared the solution gate, and the effect is never dispatched', async () => {
    issueContainerFindFirst.mockResolvedValue(approvedRow({ state: 'ready', gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null } }));
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(409);
    expect(stagingSendMock).not.toHaveBeenCalled();
    expect(issueContainerUpdateMany).not.toHaveBeenCalled();
  });

  it('503 when staging is unconfigured, and the effect is never dispatched', async () => {
    delete process.env.STAGING_SERVICE_URL;
    issueContainerFindFirst.mockResolvedValue(approvedRow());
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(503);
    expect(stagingSendMock).not.toHaveBeenCalled();
    expect(issueContainerUpdateMany).not.toHaveBeenCalled();
  });

  it('happy path (audit baseline): a real "opened" outcome -> 200 and state advances to posted', async () => {
    issueContainerFindFirst.mockResolvedValue(approvedRow());
    stagingSendMock.mockResolvedValue({ status: 'opened', prNumber: 42, url: 'https://x/pr/42' });
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(200);
    expect(stagingSendMock).toHaveBeenCalledTimes(1);
    expect(issueContainerUpdateMany).toHaveBeenCalledTimes(1);
    const [[call]] = issueContainerUpdateMany.mock.calls;
    expect(call.data.state).toBe('posted');
  });

  it('idempotent re-send (audit baseline): "already_open" also advances to posted and returns 200', async () => {
    issueContainerFindFirst.mockResolvedValue(approvedRow());
    stagingSendMock.mockResolvedValue({ status: 'already_open', prNumber: 42 });
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(200);
    expect(issueContainerUpdateMany).toHaveBeenCalledTimes(1);
  });

  // --- The dispatch-before-ack regression pin -------------------------------
  // THIS is the test inverted-and-reverted for Step 2 of the Task 9 report.

  it('REGRESSION: when the real send fails (502), the container must NOT advance to posted and the route must NOT report success', async () => {
    issueContainerFindFirst.mockResolvedValue(approvedRow());
    stagingSendMock.mockResolvedValue({ status: 'failed', reason: 'host unreachable' });

    const res = await POST(req(), ctx(CONTAINER_ID));

    expect(res.status).toBe(502);
    expect(res.status).not.toBe(200);
    // The persisted state must never move to `posted` off the back of a
    // failed send — the effect (client.send) must be checked BEFORE any
    // write, not the other way around.
    expect(issueContainerUpdateMany).not.toHaveBeenCalled();
  });

  it('REGRESSION: a "not_approved" outcome from the webhook side (defense-in-depth) never advances state', async () => {
    issueContainerFindFirst.mockResolvedValue(approvedRow());
    stagingSendMock.mockResolvedValue({ status: 'not_approved' });
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(409);
    expect(issueContainerUpdateMany).not.toHaveBeenCalled();
  });

  it('REGRESSION: a "bad_request" outcome never advances state', async () => {
    issueContainerFindFirst.mockResolvedValue(approvedRow());
    stagingSendMock.mockResolvedValue({ status: 'bad_request', reason: 'missing field' });
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(400);
    expect(issueContainerUpdateMany).not.toHaveBeenCalled();
  });
});
