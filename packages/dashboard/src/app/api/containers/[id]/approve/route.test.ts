/**
 * Regression tests — dispatch-before-ack audit, Phase 2 Task 9.
 *
 * This route's own comment (route.ts:1-17) says it re-checks `canApprove`
 * against the STORED row, writes, then returns 200. These tests pin that
 * ordering so a future change cannot silently invert it: the persisted write
 * must be confirmed before the route claims success, and a write that never
 * lands (zero rows updated, or the store throwing) must never be reported as
 * an approval.
 *
 * See `.superpowers/sdd/task-9-brief.md` and the "Precedence"/"Global
 * Constraints" sections of
 * docs/superpowers/plans/2026-07-21-obs-phase-2-healing-alerting.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

// Fake the DB slice PrismaContainerStore uses, plus the work-item hook the
// route also touches. The real class (PrismaContainerStore) is exercised
// as-is — only its Prisma dependency is faked — so these tests pin the
// route's real ordering, not a mocked shortcut of it.
const issueContainerFindFirst = vi.fn();
const issueContainerUpdateMany = vi.fn();
const workItemUpdateMany = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    issueContainer: {
      findFirst: (...a: unknown[]) => issueContainerFindFirst(...a),
      updateMany: (...a: unknown[]) => issueContainerUpdateMany(...a),
    },
    workItem: {
      updateMany: (...a: unknown[]) => workItemUpdateMany(...a),
    },
  },
}));

import { POST } from './route';

const INSTALLATION_ID = 'inst-1';
const CONTAINER_ID = 'container-1';

function req() {
  return new Request(`http://localhost/api/containers/${CONTAINER_ID}/approve`, {
    method: 'POST',
  }) as any;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function storedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONTAINER_ID,
    installationId: INSTALLATION_ID,
    state: 'ready',
    gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
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
  workItemUpdateMany.mockReset();
  authMock.mockResolvedValue({
    user: { email: 'human@example.com' },
    installations: [{ id: INSTALLATION_ID }],
  });
  workItemUpdateMany.mockResolvedValue({ count: 0 });
});

describe('POST /api/containers/[id]/approve — dispatch-before-ack', () => {
  it('401 when unauthenticated, and never reads or writes the row', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(401);
    expect(issueContainerFindFirst).not.toHaveBeenCalled();
    expect(issueContainerUpdateMany).not.toHaveBeenCalled();
  });

  it('404 when no stored row exists for the caller\'s installations, and never writes', async () => {
    issueContainerFindFirst.mockResolvedValue(null);
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(404);
    expect(issueContainerUpdateMany).not.toHaveBeenCalled();
  });

  it('409 when the STORED state is not "ready", and the gate is checked before any write', async () => {
    issueContainerFindFirst.mockResolvedValue(storedRow({ state: 'posted' }));
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('not_ready');
    // The gate check must precede the effect — no write is attempted at all.
    expect(issueContainerUpdateMany).not.toHaveBeenCalled();
  });

  it('happy path (audit baseline): confirmed write -> 200 and state advances to solution_approved', async () => {
    issueContainerFindFirst.mockResolvedValue(storedRow({ state: 'ready' }));
    issueContainerUpdateMany.mockResolvedValue({ count: 1 });
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.container.state).toBe('solution_approved');
    expect(issueContainerUpdateMany).toHaveBeenCalledTimes(1);
    const [[call]] = issueContainerUpdateMany.mock.calls;
    expect(call.data.state).toBe('solution_approved');
  });

  // --- The dispatch-before-ack regression pins -----------------------------

  it('REGRESSION: a write that lands on zero rows (lost/concurrent-deleted row) must return 404, never 200', async () => {
    issueContainerFindFirst.mockResolvedValue(storedRow({ state: 'ready' }));
    issueContainerUpdateMany.mockResolvedValue({ count: 0 }); // effect did not land
    const res = await POST(req(), ctx(CONTAINER_ID));
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.container).toBeUndefined();
    expect(body.error).toBe('not_found');
  });

  it('REGRESSION: a write that throws must never be swallowed into a 200 success response', async () => {
    issueContainerFindFirst.mockResolvedValue(storedRow({ state: 'ready' }));
    issueContainerUpdateMany.mockRejectedValue(new Error('db unavailable'));
    // The route makes no attempt to catch a failed persistence write and
    // fabricate success — the failure must propagate. If a future change
    // wrapped this in a try/catch that still returned 200, this test would
    // start failing (see Step 2 of the Task 9 report for a captured proof
    // of exactly that inversion on the sibling /send route).
    await expect(POST(req(), ctx(CONTAINER_ID))).rejects.toThrow('db unavailable');
  });
});
