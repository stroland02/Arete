import { describe, it, expect } from 'vitest';
import {
  getConnectedTelemetryProviders,
  getDashboardViewModel,
  getDashboardsViewModel,
  getMasterGridSnapshots,
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
interface FakeTelemetryConnection {
  id: string;
  installationId: string;
  provider: string;
}
interface FakeTelemetrySnapshot {
  id: string;
  installationId: string;
  provider: string;
  sourceRef: string;
  summaryText: string;
  metrics: Record<string, number>;
  links: string[];
  fetchedAt: Date;
}

function createFakeDb(
  repos: FakeRepo[],
  reviews: FakeReview[],
  comments: FakeComment[],
  telemetryConnections: FakeTelemetryConnection[] = [],
  telemetrySnapshots: FakeTelemetrySnapshot[] = []
) {
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
      groupBy: async ({ by, where }: any) => {
        const matched = reviews.filter((v) => reviewMatchesRepoScope(v, where.repository));
        const field = by[0] as 'riskLevel' | 'repositoryId';
        const counts = new Map<string, number>();
        for (const v of matched) {
          const key = String((v as any)[field]);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return [...counts.entries()]
          .map(([k, count]) => ({ [field]: k, _count: { [field]: count } }))
          .sort((a: any, b: any) => b._count[field] - a._count[field]);
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
      groupBy: async ({ by, where }: any) => {
        const field = by[0] as 'category' | 'severity';
        const matched = comments.filter((c) =>
          reviewMatchesRepoScope(reviewById.get(c.reviewId)!, where.review.repository)
        );
        const counts = new Map<string, number>();
        for (const c of matched) counts.set((c as any)[field], (counts.get((c as any)[field]) ?? 0) + 1);
        return [...counts.entries()]
          .map(([k, count]) => ({ [field]: k, _count: { [field]: count } }))
          .sort((a: any, b: any) => b._count[field] - a._count[field]);
      },
    },
    telemetryConnection: {
      findMany: async ({ where, distinct }: any) => {
        const matched = telemetryConnections.filter((c) =>
          inScope(c.installationId, where.installationId.in)
        );
        if (!distinct?.includes('provider')) return matched;
        const seen = new Set<string>();
        return matched.filter((c) => {
          if (seen.has(c.provider)) return false;
          seen.add(c.provider);
          return true;
        });
      },
    },
    telemetrySnapshotRecord: {
      findMany: async ({ where, orderBy }: any) => {
        const matched = telemetrySnapshots.filter((s) =>
          inScope(s.installationId, where.installationId.in)
        );
        return matched.sort((a, b) =>
          orderBy?.fetchedAt === 'desc'
            ? b.fetchedAt.getTime() - a.fetchedAt.getTime()
            : a.fetchedAt.getTime() - b.fetchedAt.getTime()
        );
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

describe('getConnectedTelemetryProviders', () => {
  it('returns only the requesting installation\'s connected providers, deduplicated', async () => {
    const db = createFakeDb([], [], [], [
      { id: 'conn-1', installationId: 'inst-a', provider: 'sentry' },
      { id: 'conn-2', installationId: 'inst-a', provider: 'vercel' },
      // Same installation somehow has two rows for the same provider — the
      // query must still report it once (distinct), not double-count it.
      { id: 'conn-3', installationId: 'inst-a', provider: 'sentry' },
      { id: 'conn-4', installationId: 'inst-b', provider: 'stripe' },
    ]);

    const result = await getConnectedTelemetryProviders(db as any, ['inst-a']);

    expect(result.sort()).toEqual(['sentry', 'vercel']);
    expect(result).not.toContain('stripe'); // installation B's connection must never leak in
  });

  it('aggregates providers across multiple authorized installations', async () => {
    const db = createFakeDb([], [], [], [
      { id: 'conn-1', installationId: 'inst-a', provider: 'sentry' },
      { id: 'conn-2', installationId: 'inst-b', provider: 'stripe' },
    ]);

    const result = await getConnectedTelemetryProviders(db as any, ['inst-a', 'inst-b']);

    expect(result.sort()).toEqual(['sentry', 'stripe']);
  });

  it('never queries the db and returns an empty array for zero authorized installations', async () => {
    let queried = false;
    const db = {
      telemetryConnection: { findMany: async () => { queried = true; return []; } },
    };

    const result = await getConnectedTelemetryProviders(db as any, []);

    expect(result).toEqual([]);
    expect(queried).toBe(false);
  });
});

describe('getDashboardsViewModel', () => {
  it('returns hasAccess:false for zero installations without querying', async () => {
    let queried = false;
    const db = {
      review: {
        count: async () => { queried = true; return 0; },
        findMany: async () => { queried = true; return []; },
        groupBy: async () => { queried = true; return []; },
      },
      reviewComment: {
        count: async () => { queried = true; return 0; },
        groupBy: async () => { queried = true; return []; },
      },
      repository: { findMany: async () => { queried = true; return []; } },
      telemetrySnapshotRecord: { findMany: async () => { queried = true; return []; } },
    };
    const result = await getDashboardsViewModel(db as any, []);
    expect(result).toEqual({ hasAccess: false });
    expect(queried).toBe(false);
  });

  it('aggregates only in-scope data and shapes breakdowns', async () => {
    const repos: FakeRepo[] = [
      { id: 'r1', installationId: 'inst-a', fullName: 'acme/api', createdAt: new Date('2026-07-01') },
      { id: 'r2', installationId: 'inst-b', fullName: 'globex/web', createdAt: new Date('2026-07-01') },
    ];
    const reviews: FakeReview[] = [
      { id: 'v1', repositoryId: 'r1', prNumber: 1, riskLevel: 'high', createdAt: new Date() },
      { id: 'v2', repositoryId: 'r1', prNumber: 2, riskLevel: 'low', createdAt: new Date() },
      { id: 'v3', repositoryId: 'r2', prNumber: 9, riskLevel: 'critical', createdAt: new Date() },
    ];
    const comments: FakeComment[] = [
      { id: 'c1', reviewId: 'v1', severity: 'error', category: 'security' },
      { id: 'c2', reviewId: 'v1', severity: 'warning', category: 'performance' },
      { id: 'c3', reviewId: 'v3', severity: 'error', category: 'security' },
    ];
    const db = createFakeDb(repos, reviews, comments);

    const result = await getDashboardsViewModel(db as any, ['inst-a']);
    if (!result.hasAccess) throw new Error('expected access');

    expect(result.totalPrs).toBe(2);            // only inst-a's r1 reviews
    expect(result.criticalBugs).toBe(1);        // only c1 (error) in scope; c3 is inst-b
    expect(result.byRepo).toEqual([{ fullName: 'acme/api', count: 2 }]);
    expect(result.bySeverity.find((s) => s.category === 'error')?.count).toBe(1);
    expect(result.byRisk.map((r) => r.category).sort()).toEqual(['high', 'low']);
    expect(result.reviewDates).toHaveLength(2);
    expect(result.telemetry).toEqual([]);
  });
});

describe('getMasterGridSnapshots', () => {
  it('returns only the requesting installation\'s snapshots, newest first', async () => {
    const db = createFakeDb([], [], [], [], [
      {
        id: 'snap-1',
        installationId: 'inst-a',
        provider: 'sentry',
        sourceRef: 'acme/api',
        summaryText: '2 new issues',
        metrics: { issue_count: 2 },
        links: ['https://sentry.io/1'],
        fetchedAt: new Date('2026-07-10'),
      },
      {
        id: 'snap-2',
        installationId: 'inst-a',
        provider: 'vercel',
        sourceRef: 'acme/web',
        summaryText: '1 failed deploy',
        metrics: { failed_deploys: 1 },
        links: ['https://vercel.com/1'],
        fetchedAt: new Date('2026-07-12'),
      },
      {
        id: 'snap-3',
        installationId: 'inst-b',
        provider: 'stripe',
        sourceRef: 'account',
        summaryText: 'installation B data — must never leak',
        metrics: {},
        links: [],
        fetchedAt: new Date('2026-07-11'),
      },
    ]);

    const result = await getMasterGridSnapshots(db as any, ['inst-a']);

    expect(result).toHaveLength(2);
    expect(result[0].provider).toBe('vercel'); // newest (2026-07-12) first
    expect(result[1].provider).toBe('sentry');
    expect(result.some((s) => s.summaryText.includes('installation B'))).toBe(false);
  });

  it('never queries the db and returns an empty array for zero authorized installations', async () => {
    let queried = false;
    const db = {
      telemetrySnapshotRecord: { findMany: async () => { queried = true; return []; } },
    };

    const result = await getMasterGridSnapshots(db as any, []);

    expect(result).toEqual([]);
    expect(queried).toBe(false);
  });
});
