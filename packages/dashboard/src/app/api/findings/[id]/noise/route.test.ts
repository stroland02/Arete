/**
 * Stage 1.4 — the human end of the noise loop.
 *
 * These tests pin the two properties that make this route safe to expose:
 *   1. A human may assert only OPEN or SILENCED. UNDER_OBSERVATION and
 *      ESCALATED belong to the escalation machine, which derives them from a
 *      recurrence count no button has measured.
 *   2. Tenancy lives in the WHERE clause, so another installation's finding
 *      matches nothing and is reported as absent — never as forbidden, which
 *      would itself confirm the row exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const reviewCommentUpdateMany = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { reviewComment: { updateMany: (...a: unknown[]) => reviewCommentUpdateMany(...a) } },
}));

import { POST } from './route';

const FINDING_ID = 'comment-1';

function req(body: unknown, raw?: string) {
  return new Request(`http://localhost/api/findings/${FINDING_ID}/noise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  }) as never;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function signedIn(installationIds: string[] = ['inst-1']) {
  authMock.mockResolvedValue({
    user: { email: 'dev@arete.local' },
    installations: installationIds.map((id) => ({ id })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  reviewCommentUpdateMany.mockResolvedValue({ count: 1 });
});

describe('POST /api/findings/[id]/noise', () => {
  it('silences a finding, scoping the write by installation in the WHERE clause', async () => {
    signedIn(['inst-1', 'inst-2']);

    const res = await POST(req({ state: 'SILENCED' }), ctx(FINDING_ID));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: FINDING_ID, noiseState: 'SILENCED' });
    expect(reviewCommentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: FINDING_ID,
        review: { repository: { installationId: { in: ['inst-1', 'inst-2'] } } },
      },
      data: { noiseState: 'SILENCED' },
    });
  });

  it('restores a silenced finding to OPEN', async () => {
    signedIn();

    const res = await POST(req({ state: 'OPEN' }), ctx(FINDING_ID));

    expect(res.status).toBe(200);
    expect(reviewCommentUpdateMany.mock.calls[0][0].data).toEqual({ noiseState: 'OPEN' });
  });

  it('never writes occurrenceCount — recurrence history survives a silence', async () => {
    signedIn();

    await POST(req({ state: 'SILENCED' }), ctx(FINDING_ID));

    expect(reviewCommentUpdateMany.mock.calls[0][0].data).not.toHaveProperty('occurrenceCount');
  });

  it.each(['UNDER_OBSERVATION', 'ESCALATED'])(
    'refuses %s — that state is the escalation machine to assign, not a human',
    async (state) => {
      signedIn();

      const res = await POST(req({ state }), ctx(FINDING_ID));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_state');
      expect(reviewCommentUpdateMany).not.toHaveBeenCalled();
    },
  );

  it('refuses an unknown state rather than writing whatever it was handed', async () => {
    signedIn();

    const res = await POST(req({ state: 'DELETED' }), ctx(FINDING_ID));

    expect(res.status).toBe(400);
    expect(reviewCommentUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses a non-string state', async () => {
    signedIn();

    const res = await POST(req({ state: { $ne: null } }), ctx(FINDING_ID));

    expect(res.status).toBe(400);
    expect(reviewCommentUpdateMany).not.toHaveBeenCalled();
  });

  it('reports malformed JSON as a bad request, not a server error', async () => {
    signedIn();

    const res = await POST(req(null, '{not json'), ctx(FINDING_ID));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(reviewCommentUpdateMany).not.toHaveBeenCalled();
  });

  it('401s an anonymous caller before touching the database', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(req({ state: 'SILENCED' }), ctx(FINDING_ID));

    expect(res.status).toBe(401);
    expect(reviewCommentUpdateMany).not.toHaveBeenCalled();
  });

  it("reports another tenant's finding as not-found, never as forbidden", async () => {
    // The scoped update simply matches no row. A 403 would confirm the id
    // names something real, which is exactly what must not leak.
    signedIn();
    reviewCommentUpdateMany.mockResolvedValue({ count: 0 });

    const res = await POST(req({ state: 'SILENCED' }), ctx('someone-elses-finding'));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('404s a caller with no installations without querying at all', async () => {
    signedIn([]);

    const res = await POST(req({ state: 'SILENCED' }), ctx(FINDING_ID));

    expect(res.status).toBe(404);
    expect(reviewCommentUpdateMany).not.toHaveBeenCalled();
  });
});
