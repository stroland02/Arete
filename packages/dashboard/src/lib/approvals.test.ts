import { describe, it, expect, vi } from 'vitest';
import { getPendingApprovals, findOwnedApproval } from './approvals';

function approvalRow(over: Record<string, unknown> = {}) {
  return {
    id: 'ap-1',
    command: 'aws s3 rm s3://build-cache/pr-42 --recursive',
    reason: 'The stale build cache is what makes this PR fail to reproduce.',
    status: 'PENDING',
    executedAt: null,
    createdAt: new Date('2026-07-20T09:00:00Z'),
    review: { prNumber: 42, repository: { fullName: 'acme/shop' } },
    ...over,
  };
}

function fakeDb(rows: unknown[] = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { db: { approvalPrompt: { findMany } } as never, findMany };
}

describe('getPendingApprovals', () => {
  it('scopes the read through review.repository.installationId and returns only PENDING, oldest first', async () => {
    const { db, findMany } = fakeDb([approvalRow()]);

    const approvals = await getPendingApprovals(db, ['inst-1', 'inst-2']);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING',
          executedAt: null,
          review: { repository: { installationId: { in: ['inst-1', 'inst-2'] } } },
        }),
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      id: 'ap-1',
      repositoryFullName: 'acme/shop',
      prNumber: 42,
      createdAt: '2026-07-20T09:00:00.000Z',
    });
  });

  it('passes the command through VERBATIM — a human approves the exact string that runs', async () => {
    const command = 'kubectl delete pod  api-7f9  --grace-period=0 --force';
    const { db } = fakeDb([approvalRow({ command })]);

    const approvals = await getPendingApprovals(db, ['inst-1']);

    expect(approvals[0].command).toBe(command);
  });

  it('returns [] without touching the db when the caller has no installations', async () => {
    const { db, findMany } = fakeDb([approvalRow()]);

    expect(await getPendingApprovals(db, [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('survives a row whose review context is missing rather than dropping the approval', async () => {
    // The decision still has to be presentable: losing the repo name must not
    // lose the pending command itself.
    const { db } = fakeDb([approvalRow({ review: null })]);

    const approvals = await getPendingApprovals(db, ['inst-1']);

    expect(approvals).toHaveLength(1);
    expect(approvals[0].repositoryFullName).toBe('unknown repository');
    expect(approvals[0].prNumber).toBe(0);
  });
});

describe('findOwnedApproval', () => {
  it('resolves only within the caller installations', async () => {
    const { db, findMany } = fakeDb([approvalRow()]);

    const owned = await findOwnedApproval(db, ['inst-1'], 'ap-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'ap-1',
          review: { repository: { installationId: { in: ['inst-1'] } } },
        }),
      }),
    );
    expect(owned).toMatchObject({ id: 'ap-1', status: 'PENDING', executedAt: null });
  });

  it("returns null for another tenant's approval — not-found, never forbidden-but-existing", async () => {
    // The scoped query simply matches nothing; the caller can't tell the id apart
    // from one that never existed, which is the point.
    const { db } = fakeDb([]);

    expect(await findOwnedApproval(db, ['inst-1'], 'ap-someone-elses')).toBeNull();
  });

  it('returns null without querying when the caller has no installations', async () => {
    const { db, findMany } = fakeDb([approvalRow()]);

    expect(await findOwnedApproval(db, [], 'ap-1')).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('reports an executed approval with its executedAt so callers can refuse to re-action it', async () => {
    const executedAt = new Date('2026-07-21T10:30:00Z');
    const { db } = fakeDb([approvalRow({ status: 'EXECUTED', executedAt })]);

    const owned = await findOwnedApproval(db, ['inst-1'], 'ap-1');

    expect(owned?.status).toBe('EXECUTED');
    expect(owned?.executedAt?.toISOString()).toBe('2026-07-21T10:30:00.000Z');
  });
});
