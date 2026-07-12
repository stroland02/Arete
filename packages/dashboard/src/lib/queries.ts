import type { PrismaClient } from '@arete/db';
import type { AuthorizedInstallation } from './installations';

/**
 * Picks which authorized installation(s) the current page view should query:
 * - `?installation=<id>` selects a single installation, IF it's one the
 *   session is actually authorized for (never trust the query param alone —
 *   an attacker could put another tenant's installation id in the URL).
 * - Otherwise, aggregate across every installation the session is
 *   authorized for.
 */
export function resolveSelectedInstallationIds(
  authorized: AuthorizedInstallation[],
  requestedInstallationId: string | undefined
): string[] {
  if (requestedInstallationId) {
    const match = authorized.find((i) => i.id === requestedInstallationId);
    if (match) return [match.id];
  }
  return authorized.map((i) => i.id);
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface ReviewSummary {
  id: string;
  prNumber: number;
  riskLevel: string;
  createdAt: Date;
  repositoryFullName: string;
}

export interface WeeklyChange {
  change: string;
  positive: boolean;
}

export type DashboardViewModel =
  | { hasAccess: false }
  | {
      hasAccess: true;
      totalPrs: number;
      activeRepos: number;
      criticalBugs: number;
      recentReviews: number;
      weeklyDelta: number;
      totalPrsChange: WeeklyChange;
      criticalBugsChange: WeeklyChange;
      repoDelta: number;
      commentsByCategory: CategoryCount[];
      latestReviews: ReviewSummary[];
    };

function weeklyChange(current: number, prior: number): WeeklyChange {
  const delta = current - prior;
  const positive = delta >= 0;
  const sign = positive ? '+' : '';
  if (prior === 0) {
    return { change: `${sign}${delta}`, positive };
  }
  return { change: `${sign}${((delta / prior) * 100).toFixed(1)}%`, positive };
}

/**
 * Loads every metric the dashboard overview page needs, scoped to
 * `installationIds`. This is the single choke point all dashboard queries
 * must go through: every `where` clause below filters through
 * `repository: { installationId: { in: installationIds } }` (or the
 * installation itself), so a review belonging to an installation NOT in
 * this list can never appear in the result — regardless of how many other
 * tenants' data exists in the same database.
 *
 * `installationIds` are Installation primary keys (already provider-scoped
 * 1:1 via the schema's `@@unique([provider, externalId])`), resolved from
 * the session by resolveSelectedInstallationIds(). An empty list means the
 * caller has zero authorized installations; no query is run and the
 * "install the app" empty state is signaled via `hasAccess: false`.
 */
export async function getDashboardViewModel(
  db: PrismaClient,
  installationIds: string[]
): Promise<DashboardViewModel> {
  if (installationIds.length === 0) {
    return { hasAccess: false };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const repoScope = { installationId: { in: installationIds } } as const;

  const [
    totalPrs,
    activeRepos,
    criticalBugs,
    recentReviews,
    previousWeekReviews,
    priorTotalPrs,
    priorCriticalBugs,
    priorActiveRepos,
    commentsByCategory,
    latestReviews,
  ] = await Promise.all([
    db.review.count({ where: { repository: repoScope } }),
    db.repository.count({ where: repoScope }),
    db.reviewComment.count({
      where: { severity: 'error', review: { repository: repoScope } },
    }),
    db.review.count({
      where: { repository: repoScope, createdAt: { gte: sevenDaysAgo } },
    }),
    db.review.count({
      where: { repository: repoScope, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
    }),
    db.review.count({ where: { repository: repoScope, createdAt: { lt: sevenDaysAgo } } }),
    db.reviewComment.count({
      where: {
        severity: 'error',
        review: { repository: repoScope, createdAt: { lt: sevenDaysAgo } },
      },
    }),
    db.repository.count({ where: { ...repoScope, createdAt: { lt: sevenDaysAgo } } }),
    db.reviewComment.groupBy({
      by: ['category'],
      where: { review: { repository: repoScope } },
      _count: { category: true },
      orderBy: { _count: { category: 'desc' } },
    }),
    db.review.findMany({
      where: { repository: repoScope },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { repository: true },
    }),
  ]);

  const weeklyDelta = recentReviews - previousWeekReviews;
  const repoDelta = activeRepos - priorActiveRepos;

  return {
    hasAccess: true,
    totalPrs,
    activeRepos,
    criticalBugs,
    recentReviews,
    weeklyDelta,
    totalPrsChange: weeklyChange(totalPrs, priorTotalPrs),
    criticalBugsChange: weeklyChange(criticalBugs, priorCriticalBugs),
    repoDelta,
    commentsByCategory: commentsByCategory.map((c) => ({
      category: c.category,
      count: c._count.category,
    })),
    latestReviews: latestReviews.map((r) => ({
      id: r.id,
      prNumber: r.prNumber,
      riskLevel: r.riskLevel,
      createdAt: r.createdAt,
      repositoryFullName: r.repository.fullName,
    })),
  };
}

/**
 * Distinct telemetry providers (Sentry, Vercel, Stripe, PostHog, GitHub
 * Actions, ...) actually connected for any of `installationIds`. Backs the
 * agent orchestration graph's telemetry-sources cluster, which must only
 * ever show a provider the tenant genuinely connected — never a static
 * catalog of providers we merely support.
 */
export async function getConnectedTelemetryProviders(
  db: PrismaClient,
  installationIds: string[]
): Promise<string[]> {
  if (installationIds.length === 0) {
    return [];
  }

  const connections = await db.telemetryConnection.findMany({
    where: { installationId: { in: installationIds } },
    select: { provider: true },
    distinct: ['provider'],
  });

  return connections.map((c) => c.provider);
}

export interface TrendSeries {
  reviewDates: Date[];
  repoDates: Date[];
}

/**
 * Supplies the raw per-review/per-repository creation timestamps that
 * getDashboardViewModel doesn't expose (it only returns pre-aggregated
 * counts and change strings). Consumers derive 7-day sparkline series from
 * these via bucketByDay/cumulativeByDay (src/lib/trends.ts). Scoped
 * identically to getDashboardViewModel — same repoScope shape — so an
 * installation not in `installationIds` can never contribute a data point
 * here either.
 */
export async function getTrendSeries(
  db: PrismaClient,
  installationIds: string[]
): Promise<TrendSeries> {
  if (installationIds.length === 0) {
    return { reviewDates: [], repoDates: [] };
  }

  const repoScope = { installationId: { in: installationIds } } as const;

  const [reviewDates, repoDates] = await Promise.all([
    db.review.findMany({
      where: { repository: repoScope },
      select: { createdAt: true },
    }),
    db.repository.findMany({
      where: repoScope,
      select: { createdAt: true },
    }),
  ]);

  return {
    reviewDates: reviewDates.map((r) => r.createdAt),
    repoDates: repoDates.map((r) => r.createdAt),
  };
}
