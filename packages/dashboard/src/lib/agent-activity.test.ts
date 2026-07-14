import { describe, it, expect } from 'vitest';
import { getAgentActivity } from './queries';

// Self-contained fake of the one Prisma method getAgentActivity uses, built
// the same way as queries.test.ts's fake: exercise the REAL query-building
// code (the where/include shape), not a mock of it.
function makeDb(
  comments: Array<{ id: string; reviewId: string; category: string; path: string; line: number; body: string; severity: string; createdAt: Date }>,
  reviewById: Record<string, { repositoryId: string; prNumber: number }>,
  repoById: Record<string, { installationId: string; fullName: string }>,
) {
  return {
    reviewComment: {
      findMany: async ({ where, take, orderBy }: any) => {
        const ids: string[] = where.review.repository.installationId.in;
        const matched = comments.filter((c) => {
          const review = reviewById[c.reviewId];
          const repo = repoById[review.repositoryId];
          return ids.includes(repo.installationId);
        });
        matched.sort((a, b) =>
          orderBy?.createdAt === 'desc'
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        return matched.slice(0, take).map((c) => {
          const review = reviewById[c.reviewId];
          return { ...c, review: { ...review, repository: repoById[review.repositoryId] } };
        });
      },
    },
  } as any;
}

const now = new Date('2026-07-13T00:00:00Z');
const earlier = new Date('2026-07-12T00:00:00Z');

describe('getAgentActivity', () => {
  it('returns [] without querying when no installations are authorized', async () => {
    const db = makeDb([], {}, {});
    expect(await getAgentActivity(db, [])).toEqual([]);
  });

  it('never returns a finding from an installation outside the authorized set', async () => {
    const comments = [
      { id: 'c-a', reviewId: 'r-a', category: 'security', path: 'a.ts', line: 1, body: 'A finding', severity: 'error', createdAt: now },
      { id: 'c-b', reviewId: 'r-b', category: 'security', path: 'b.ts', line: 2, body: 'B finding', severity: 'error', createdAt: now },
    ];
    const reviewById = { 'r-a': { repositoryId: 'repo-a', prNumber: 11 }, 'r-b': { repositoryId: 'repo-b', prNumber: 22 } };
    const repoById = { 'repo-a': { installationId: 'inst-a', fullName: 'acme/api' }, 'repo-b': { installationId: 'inst-b', fullName: 'globex/web' } };
    const db = makeDb(comments, reviewById, repoById);

    const result = await getAgentActivity(db, ['inst-a']);

    expect(result.map((f) => f.body)).toEqual(['A finding']);
  });

  it('maps every field and orders newest-first', async () => {
    const comments = [
      { id: 'c1', reviewId: 'r1', category: 'performance', path: 'old.ts', line: 5, body: 'older', severity: 'warning', createdAt: earlier },
      { id: 'c2', reviewId: 'r1', category: 'security', path: 'new.ts', line: 9, body: 'newer', severity: 'error', createdAt: now },
    ];
    const reviewById = { 'r1': { repositoryId: 'repo-a', prNumber: 42 } };
    const repoById = { 'repo-a': { installationId: 'inst-a', fullName: 'acme/api' } };
    const db = makeDb(comments, reviewById, repoById);

    const result = await getAgentActivity(db, ['inst-a']);

    expect(result[0]).toEqual({
      reviewId: 'r1', prNumber: 42, repositoryFullName: 'acme/api', createdAt: now,
      category: 'security', path: 'new.ts', line: 9, body: 'newer', severity: 'error',
    });
    expect(result[1].body).toBe('older');
  });
});
