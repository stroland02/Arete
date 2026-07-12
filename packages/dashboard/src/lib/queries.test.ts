import { describe, it, expect } from 'vitest';
import {
  getDashboardViewModel,
  getTrendSeries,
  resolveSelectedInstallationIds,
  type DashboardViewModel,
} from './queries';
import type { AuthorizedInstallation } from './installations';

// ---------------------------------------------------------------------------
// In-memory fake Prisma. Mirrors the shapes packages/webhook/src/tenancy.test.ts
// uses for the same reason: prove the tenancy-scoping property against the
// real query-building code (getDashboardViewModel), not a mock of it.
// ---------------------------------------------------------------------------
interface FakeRepo {
  id: string;
  installationId: string;
  fullName: string;
  createdAt: Date;
}
interface FakeReview {
  id: string;
  repositoryId: string;
  prNumber: number;
  riskLevel: string;
  createdAt: Date;
}
interface FakeComment {
  id: string;
  reviewId: string;
  severity: string;
  category: string;
}

function createFakeDb(repos: FakeRepo[], reviews: FakeReview[], comments: FakeComment[]) {
  const repoById = new Map(repos.map((r) => [r.id, r]));
  const reviewById = new Map(reviews.map((r) => [r.id, r]));

  const inScope = (installationId: string, ids: string[]) => ids.includes(installationId);

  const matchesCreatedAt = (date: Date, cond: { gte?: Date; lt?: Date } | undefined) => {
    if (!cond) return true;
    if (cond.gte && date < cond.gte) return false;
    if (cond.lt && date >= cond.lt) return false;
    return true;
  };

  const reviewMatchesRepoScope = (review: FakeReview, repoWhere: { installationId: { in: string[] } }) => {
    const repo = repoById.get(review.repositoryId)!;
    return inScope(repo.installationId, repoWhere.installationId.in);
  };

  return {
    repository: {
      count: async ({ where }: any) => {
        return repos.filter(
          (r) =>
            inScope(r.installationId, where.installationId.in) &&
            matchesCreatedAt(r.createdAt, where.createdAt)
        ).length;
      },
      findMany: async ({ where, select }: any) => {
        void select;
        return repos.filter(
          (r) =>
            inScope(r.installationId, where.installationId.in) &&
            matchesCreatedAt(r.createdAt, where.createdAt)
        );
      },
    },
    review: {
      count: async ({ where }: any) => {
        return reviews.filter(
          (r) =>
            reviewMatchesRepoScope(r, where.repository) && matchesCreatedAt(r.createdAt, where.createdAt)
        ).length;
      },
      findMany: async ({ where, take, orderBy, include }: any) => {
        void include;
        const filtered = reviews
          .filter((r) => reviewMatchesRepoScope(r, where.repository))
          .sort((a, b) =>
            orderBy?.createdAt === 'desc'
              ? b.createdAt.getTime() - a.createdAt.getTime()
              : a.createdAt.getTime() - b.createdAt.getTime()
          )
          .slice(0, take);
        return filtered.map((r) => ({ ...r, repository: repoById.get(r.repositoryId)! }));
      },
    },
    reviewComment: {
      count: async ({ where }: any) => {
        return comments.filter((c) => {
          if (where.severity && c.severity !== where.severity) return false;
          const review = reviewById.get(c.reviewId)!;
          if (!reviewMatchesRepoScope(review, where.review.repository)) return false;
          if (!matchesCreatedAt(review.createdAt, where.review.createdAt)) return false;
          return true;
        }).length;
      },
      groupBy: async ({ where }: any) => {
        const matched = comments.filter((c) => {
          const review = reviewById.get(c.reviewId)!;
          return reviewMatchesRepoScope(review, where.review.repository);
        });
        const counts = new Map<string, number>();
        for (const c of matched) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
        return [...counts.entries()]
          .map(([category, count]) => ({ category, _count: { category: count } }))
          .sort((a, b) => b._count.category - a._count.category);
      },
    },
  };
}

describe('getDashboardViewModel: installation scoping (core tenancy security property)', () => {
  it('returns only installation A data even when installation B has reviews in the same database', async () => {
    const now = new Date();
    const repos: FakeRepo[] = [
      { id: 'repo-a', installationId: 'inst-a', fullName: 'acme/api', createdAt: now },
      { id: 'repo-b', installationId: 'inst-b', fullName: 'globex/web', createdAt: now },
    ];
    const reviews: FakeReview[] = [
      { id: 'review-a1', repositoryId: 'repo-a', prNumber: 1, riskLevel: 'low', createdAt: now },
      { id: 'review-a2', repositoryId: 'repo-a', prNumber: 2, riskLevel: 'high', createdAt: now },
      { id: 'review-b1', repositoryId: 'repo-b', prNumber: 1, riskLevel: 'critical', createdAt: now },
    ];
    const comments: FakeComment[] = [
      { id: 'c-a1', reviewId: 'review-a1', severity: 'error', category: 'security' },
      { id: 'c-b1', reviewId: 'review-b1', severity: 'error', category: 'security' },
    ];
    const db = createFakeDb(repos, reviews, comments);

    // Session authorized for installation A ONLY.
    const result = await getDashboardViewModel(db as any, ['inst-a']);

    expect(result.hasAccess).toBe(true);
    if (!result.hasAccess) throw new Error('unreachable');
    expect(result.totalPrs).toBe(2); // NOT 3 — installation B's review is excluded
    expect(result.activeRepos).toBe(1); // NOT 2
    expect(result.criticalBugs).toBe(1); // NOT 2 — B's error comment excluded
    expect(result.latestReviews.every((r) => r.repositoryFullName === 'acme/api')).toBe(true);
    expect(result.latestReviews.some((r) => r.repositoryFullName === 'globex/web')).toBe(false);
  });

  it('aggregates across multiple authorized installations when more than one id is passed', async () => {
    const now = new Date();
    const repos: FakeRepo[] = [
      { id: 'repo-a', installationId: 'inst-a', fullName: 'acme/api', createdAt: now },
      { id: 'repo-b', installationId: 'inst-b', fullName: 'globex/web', createdAt: now },
    ];
    const reviews: FakeReview[] = [
      { id: 'review-a1', repositoryId: 'repo-a', prNumber: 1, riskLevel: 'low', createdAt: now },
      { id: 'review-b1', repositoryId: 'repo-b', prNumber: 1, riskLevel: 'critical', createdAt: now },
    ];
    const db = createFakeDb(repos, reviews, []);

    const result = await getDashboardViewModel(db as any, ['inst-a', 'inst-b']);

    expect(result.hasAccess).toBe(true);
    if (!result.hasAccess) throw new Error('unreachable');
    expect(result.totalPrs).toBe(2);
    expect(result.activeRepos).toBe(2);
  });

  it('never queries the db and reports hasAccess:false for zero authorized installations', async () => {
    let queried = false;
    const db = {
      repository: { count: async () => { queried = true; return 0; } },
      review: { count: async () => { queried = true; return 0; }, findMany: async () => { queried = true; return []; } },
      reviewComment: { count: async () => { queried = true; return 0; }, groupBy: async () => { queried = true; return []; } },
    };

    const result: DashboardViewModel = await getDashboardViewModel(db as any, []);

    expect(result).toEqual({ hasAccess: false });
    expect(queried).toBe(false);
  });
});

describe('resolveSelectedInstallationIds', () => {
  const authorized: AuthorizedInstallation[] = [
    { id: 'inst-a', provider: 'github', owner: 'acme', externalId: 1 },
    { id: 'inst-b', provider: 'github', owner: 'globex', externalId: 2 },
  ];

  it('returns all authorized ids when no installation is requested', () => {
    expect(resolveSelectedInstallationIds(authorized, undefined)).toEqual(['inst-a', 'inst-b']);
  });

  it('returns just the requested id when it is one the session is authorized for', () => {
    expect(resolveSelectedInstallationIds(authorized, 'inst-b')).toEqual(['inst-b']);
  });

  it('ignores a requested id the session is NOT authorized for and falls back to all authorized ids', () => {
    // Security-relevant: a query param naming another tenant's installation
    // must never scope the query to that installation.
    expect(resolveSelectedInstallationIds(authorized, 'someone-elses-installation')).toEqual([
      'inst-a',
      'inst-b',
    ]);
  });

  it('returns an empty array when the session has zero authorized installations', () => {
    expect(resolveSelectedInstallationIds([], 'anything')).toEqual([]);
  });
});

describe('getTrendSeries', () => {
  it('only includes reviews and repositories from authorized installations', async () => {
    const repos: FakeRepo[] = [
      { id: 'repo-a', installationId: 'inst-1', fullName: 'org/a', createdAt: new Date('2026-07-01') },
      { id: 'repo-b', installationId: 'inst-2', fullName: 'org/b', createdAt: new Date('2026-07-02') },
    ];
    const reviews: FakeReview[] = [
      { id: 'rev-a', repositoryId: 'repo-a', prNumber: 1, riskLevel: 'low', createdAt: new Date('2026-07-05') },
      { id: 'rev-b', repositoryId: 'repo-b', prNumber: 2, riskLevel: 'low', createdAt: new Date('2026-07-06') },
    ];
    const db = createFakeDb(repos, reviews, []);

    const result = await getTrendSeries(db as any, ['inst-1']);

    expect(result.reviewDates).toEqual([reviews[0].createdAt]);
    expect(result.repoDates).toEqual([repos[0].createdAt]);
  });

  it('returns empty arrays when installationIds is empty', async () => {
    const db = createFakeDb([], [], []);
    const result = await getTrendSeries(db as any, []);
    expect(result.reviewDates).toEqual([]);
    expect(result.repoDates).toEqual([]);
  });
});
