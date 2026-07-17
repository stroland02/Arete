import type { PrismaClient } from '@arete/db';
import type { AuthorizedInstallation } from './installations';
import type { FindingLike } from './sensors';
import { clickhouse } from './clickhouse';

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

/**
 * The repositories Kuma is actually installed on for the caller's authorized
 * installations — the concrete "connected to what" the Connections page shows
 * next to the GitHub App. Tenant-scoped by installationId exactly like every
 * other query here, so a repo outside the caller's installations can never
 * appear. Returns full names ("owner/repo") sorted for a stable list.
 */
export async function getConnectedRepositories(
  db: PrismaClient,
  installationIds: string[]
): Promise<string[]> {
  if (installationIds.length === 0) {
    return [];
  }

  const repos = await db.repository.findMany({
    where: { installationId: { in: installationIds } },
    select: { fullName: true },
    orderBy: { fullName: "asc" },
  });

  return repos.map((r) => r.fullName);
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

export interface ReviewFinding {
  id: string;
  path: string;
  line: number;
  body: string;
  severity: string;
  category: string;
}

export interface ReviewDetail {
  id: string;
  prNumber: number;
  riskLevel: string;
  overallSummary: string;
  analysisStatus: string;
  createdAt: Date;
  repositoryFullName: string;
  findings: ReviewFinding[];
}

/**
 * Loads one review's full detail (summary + all comments), scoped to
 * `installationIds` via the same `repository: { installationId: { in } }`
 * filter as every other query in this file. Returns `null` uniformly
 * whether the review doesn't exist OR belongs to an installation outside
 * the caller's authorized set — the caller must not be able to distinguish
 * "not found" from "not yours" (that distinction itself would leak
 * information about other tenants' data).
 */
export async function getReviewDetail(
  db: PrismaClient,
  installationIds: string[],
  reviewId: string
): Promise<ReviewDetail | null> {
  if (installationIds.length === 0) return null;

  const review = await db.review.findFirst({
    where: { id: reviewId, repository: { installationId: { in: installationIds } } },
    include: { repository: true, comments: true },
  });

  if (!review) return null;

  return {
    id: review.id,
    prNumber: review.prNumber,
    riskLevel: review.riskLevel,
    overallSummary: review.overallSummary,
    analysisStatus: review.analysisStatus,
    createdAt: review.createdAt,
    repositoryFullName: review.repository.fullName,
    findings: review.comments.map((c) => ({
      id: c.id,
      path: c.path,
      line: c.line,
      body: c.body,
      severity: c.severity,
      category: c.category,
    })),
  };
}

export interface ReviewHistoryRow {
  id: string;
  prNumber: number;
  riskLevel: string;
  createdAt: Date;
  repositoryFullName: string;
}

export interface ReviewHistoryPage {
  reviews: ReviewHistoryRow[];
  total: number;
  riskCounts: Record<string, number>;
}

const PAGE_SIZE = 20;

/**
 * Paginated, tenant-scoped review list for the Review History page. Same
 * `repository: { installationId: { in } }` scoping as every other query in
 * this file. `riskLevel` filters to one risk tier when provided (matching
 * the tab pattern on the history page); `riskCounts` is always computed
 * across the FULL unfiltered tenant scope (not just the current page) so
 * the tab badges show true totals regardless of which tab is active.
 */
export async function getReviewHistory(
  db: PrismaClient,
  installationIds: string[],
  { riskLevel, page = 1 }: { riskLevel?: string; page?: number } = {}
): Promise<ReviewHistoryPage> {
  if (installationIds.length === 0) {
    return { reviews: [], total: 0, riskCounts: {} };
  }

  const repoScope = { installationId: { in: installationIds } } as const;
  const where = {
    repository: repoScope,
    ...(riskLevel ? { riskLevel } : {}),
  };

  const [reviews, total, riskGroups] = await Promise.all([
    db.review.findMany({
      where,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      orderBy: { createdAt: "desc" },
      include: { repository: true },
    }),
    db.review.count({ where }),
    db.review.groupBy({
      by: ["riskLevel"],
      where: { repository: repoScope },
      _count: { riskLevel: true },
    }),
  ]);

  const riskCounts: Record<string, number> = {};
  for (const group of riskGroups) {
    riskCounts[group.riskLevel] = group._count.riskLevel;
  }

  return {
    reviews: reviews.map((r) => ({
      id: r.id,
      prNumber: r.prNumber,
      riskLevel: r.riskLevel,
      createdAt: r.createdAt,
      repositoryFullName: r.repository.fullName,
    })),
    total,
    riskCounts,
  };
}

export interface ServiceReviewRow {
  /** IS the container id — deep-links to the live transcript stream. */
  id: string;
  prNumber: number;
  riskLevel: string;
  createdAt: string; // ISO — client-safe
  findingCount: number;
}

export interface ServiceReviewGroup {
  repositoryFullName: string;
  /** Highest risk tier across this repo's reviews — drives the rail dot. */
  worstRisk: string;
  reviews: ServiceReviewRow[];
}

// Highest-first risk ranking, so a repo's worst review sets its rail dot.
const RISK_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/**
 * The Services "triage inbox", grounded in REAL reviews: every review the
 * caller's installations produced, grouped by repository (the "service"), each
 * carrying its verified-finding count. Selecting a review streams its real
 * Synthesizer transcript via /api/containers/[id]/stream (the id IS the review
 * id). Tenant-scoped by `repository.installationId` like every query here, so a
 * review outside the caller's installations can never appear. No sample data,
 * no fabricated fixes — only reviews that actually ran.
 */
export async function getServicesInbox(
  db: PrismaClient,
  installationIds: string[]
): Promise<ServiceReviewGroup[]> {
  if (installationIds.length === 0) {
    return [];
  }

  const repoScope = { installationId: { in: installationIds } } as const;
  const reviews = await db.review.findMany({
    where: { repository: repoScope },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { repository: { select: { fullName: true } }, _count: { select: { comments: true } } },
  });

  const groups = new Map<string, ServiceReviewGroup>();
  for (const r of reviews) {
    const repo = r.repository.fullName;
    let group = groups.get(repo);
    if (!group) {
      group = { repositoryFullName: repo, worstRisk: "low", reviews: [] };
      groups.set(repo, group);
    }
    group.reviews.push({
      id: r.id,
      prNumber: r.prNumber,
      riskLevel: r.riskLevel,
      createdAt: r.createdAt.toISOString(),
      findingCount: r._count.comments,
    });
    if ((RISK_RANK[r.riskLevel.toLowerCase()] ?? 0) > (RISK_RANK[group.worstRisk] ?? 0)) {
      group.worstRisk = r.riskLevel.toLowerCase();
    }
  }

  return [...groups.values()];
}

/** 50 free reviews per installation before payment is required — mirrors
 * packages/webhook/src/billing.ts's FREE_TIER_REVIEW_LIMIT. Duplicated here
 * (not imported) because the dashboard and webhook packages don't share a
 * runtime dependency for this constant; keep the two values in sync by hand
 * if the webhook's limit ever changes. */
export const FREE_TIER_REVIEW_LIMIT = 50;

export interface InstallationBilling {
  owner: string;
  subscriptionStatus: string;
  usageCount: number;
}

/**
 * Billing summary for the Settings page, scoped to the caller's authorized
 * installations. Deliberately does NOT surface `planTier` — per
 * packages/webhook/src/billing.ts's own comment, that field is never
 * written by any business logic (only `subscriptionStatus` is authoritative)
 * so showing it would display a permanently-stale value. When multiple
 * installations are authorized, returns the first one scoped by
 * `installationIds` (matching how the rest of the dashboard treats a
 * multi-installation session — see resolveSelectedInstallationIds).
 */
export async function getInstallationBilling(
  db: PrismaClient,
  installationIds: string[]
): Promise<InstallationBilling | null> {
  if (installationIds.length === 0) return null;

  const installation = await db.installation.findFirst({
    where: { id: { in: installationIds } },
    select: { owner: true, subscriptionStatus: true, usageCount: true },
  });

  return installation;
}

export interface TelemetryGridSnapshot {
  provider: string;
  sourceRef: string;
  summaryText: string;
  metrics: Record<string, number>;
  links: string[];
  fetchedAt: Date;
}

/**
 * Loads the latest known telemetry snapshot per (provider, sourceRef) for
 * `installationIds` — backs the Master Grid page. TelemetrySnapshotRecord is
 * upserted by the webhook's review pipeline (persistTelemetrySnapshots), so
 * this always reflects "what we saw as of the last review", never a live
 * fetch. Tenancy-scoped identically to every other query in this file.
 */
export async function getMasterGridSnapshots(
  db: PrismaClient,
  installationIds: string[]
): Promise<TelemetryGridSnapshot[]> {
  if (installationIds.length === 0) return [];

  const rows = await db.telemetrySnapshotRecord.findMany({
    where: { installationId: { in: installationIds } },
    orderBy: { fetchedAt: 'desc' },
  });

  return rows.map((r) => ({
    provider: r.provider,
    sourceRef: r.sourceRef,
    summaryText: r.summaryText,
    metrics: r.metrics as Record<string, number>,
    links: r.links as string[],
    fetchedAt: r.fetchedAt,
  }));
}

export interface RepoActivity {
  fullName: string;
  count: number;
}

export type DashboardsViewModel =
  | { hasAccess: false }
  | {
      hasAccess: true;
      totalPrs: number;
      criticalBugs: number;
      recentReviews: number;
      weeklyDelta: number;
      /** Raw review creation timestamps — the client re-buckets these per range. */
      reviewDates: Date[];
      byCategory: CategoryCount[];
      bySeverity: CategoryCount[];
      byRisk: CategoryCount[];
      byRepo: RepoActivity[];
      latestReviews: ReviewSummary[];
      telemetry: TelemetryGridSnapshot[];
      /** Providers the tenant has actually connected. A telemetry snapshot whose
       *  provider is NOT here was detected (seen in a review) but is not a live
       *  connection — the grid surfaces a Connect CTA for it, never "live". */
      connectedProviders: string[];
      /** Full names of the tenant's connected repositories — the staging state
       *  the dashboard shows even before any review runs (Account-State Contract). */
      repos: string[];
      /** Whether an AI model connection exists for the tenant. */
      modelConnected: boolean;
    };

// Stable display order for severity bars (most→least severe).
const SEVERITY_ORDER = ['error', 'warning', 'info'];

/**
 * One tenant-scoped aggregate powering the /dashboards presets. Every query
 * filters through `repository: { installationId: { in: installationIds } }`,
 * so a review outside the caller's authorized installations can never appear
 * (same tenancy property as getDashboardViewModel). Returns raw review
 * timestamps so the client owns time-range bucketing without re-querying.
 */
export async function getDashboardsViewModel(
  db: PrismaClient,
  installationIds: string[]
): Promise<DashboardsViewModel> {
  if (installationIds.length === 0) {
    return { hasAccess: false };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const repoScope = { installationId: { in: installationIds } } as const;
  const reviewScope = { repository: repoScope } as const;

  const [
    totalPrs,
    criticalBugs,
    recentReviews,
    previousWeekReviews,
    reviewRows,
    byCategoryRaw,
    bySeverityRaw,
    byRiskRaw,
    byRepoRaw,
    repos,
    latestReviews,
    telemetryRows,
    connectedProviders,
    modelConnectionCount,
  ] = await Promise.all([
    db.review.count({ where: reviewScope }),
    db.reviewComment.count({ where: { severity: 'error', review: reviewScope } }),
    db.review.count({ where: { ...reviewScope, createdAt: { gte: sevenDaysAgo } } }),
    db.review.count({ where: { ...reviewScope, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } } }),
    db.review.findMany({ where: reviewScope, select: { createdAt: true } }),
    db.reviewComment.groupBy({
      by: ['category'],
      where: { review: reviewScope },
      _count: { category: true },
      orderBy: { _count: { category: 'desc' } },
    }),
    db.reviewComment.groupBy({
      by: ['severity'],
      where: { review: reviewScope },
      _count: { severity: true },
    }),
    db.review.groupBy({
      by: ['riskLevel'],
      where: reviewScope,
      _count: { riskLevel: true },
      orderBy: { _count: { riskLevel: 'desc' } },
    }),
    db.review.groupBy({
      by: ['repositoryId'],
      where: reviewScope,
      _count: { repositoryId: true },
      orderBy: { _count: { repositoryId: 'desc' } },
      take: 8,
    }),
    db.repository.findMany({ where: repoScope, select: { id: true, fullName: true } }),
    db.review.findMany({ where: reviewScope, take: 5, orderBy: { createdAt: 'desc' }, include: { repository: true } }),
    db.telemetrySnapshotRecord.findMany({ where: { installationId: { in: installationIds } }, orderBy: { fetchedAt: 'desc' } }),
    getConnectedTelemetryProviders(db, installationIds),
    db.modelConnection.count({ where: { installationId: { in: installationIds } } }),
  ]);

  const repoName = new Map(repos.map((r) => [r.id, r.fullName]));

  const bySeverity: CategoryCount[] = (bySeverityRaw as Array<{ severity: string; _count: { severity: number } }>)
    .map((s) => ({ category: s.severity, count: s._count.severity }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.category) - SEVERITY_ORDER.indexOf(b.category));

  return {
    hasAccess: true,
    totalPrs,
    criticalBugs,
    recentReviews,
    weeklyDelta: recentReviews - previousWeekReviews,
    reviewDates: reviewRows.map((r) => r.createdAt),
    byCategory: (byCategoryRaw as Array<{ category: string; _count: { category: number } }>).map((c) => ({
      category: c.category,
      count: c._count.category,
    })),
    bySeverity,
    byRisk: (byRiskRaw as Array<{ riskLevel: string; _count: { riskLevel: number } }>).map((r) => ({
      category: r.riskLevel,
      count: r._count.riskLevel,
    })),
    byRepo: (byRepoRaw as Array<{ repositoryId: string; _count: { repositoryId: number } }>).map((r) => ({
      fullName: repoName.get(r.repositoryId) ?? r.repositoryId,
      count: r._count.repositoryId,
    })),
    latestReviews: latestReviews.map((r) => ({
      id: r.id,
      prNumber: r.prNumber,
      riskLevel: r.riskLevel,
      createdAt: r.createdAt,
      repositoryFullName: r.repository.fullName,
    })),
    telemetry: telemetryRows.map((r) => ({
      provider: r.provider,
      sourceRef: r.sourceRef,
      summaryText: r.summaryText,
      metrics: r.metrics as Record<string, number>,
      links: r.links as string[],
      fetchedAt: r.fetchedAt,
    })),
    connectedProviders,
    repos: repos.map((r) => r.fullName),
    modelConnected: modelConnectionCount > 0,
  };
}

export interface AgentActivityFinding {
  reviewId: string;
  prNumber: number;
  repositoryFullName: string;
  createdAt: Date;
  category: string;
  path: string;
  line: number;
  body: string;
  severity: string;
}

/**
 * Recent review findings across the caller's authorized installations, newest
 * first. The Agents workspace slices these by the selected agent's category
 * client-side. Scoped through the same `repository: { installationId: { in } }`
 * choke point as every other query here, so a finding from an installation
 * outside `installationIds` can never appear. Empty `installationIds` => no
 * query, `[]` (the honest empty state).
 */
export async function getAgentActivity(
  db: PrismaClient,
  installationIds: string[],
  limit = 60,
): Promise<AgentActivityFinding[]> {
  if (installationIds.length === 0) return [];

  const rows = await db.reviewComment.findMany({
    where: { review: { repository: { installationId: { in: installationIds } } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { review: { include: { repository: true } } },
  });

  return rows.map((c) => ({
    reviewId: c.reviewId,
    prNumber: c.review.prNumber,
    repositoryFullName: c.review.repository.fullName,
    createdAt: c.createdAt,
    category: c.category,
    path: c.path,
    line: c.line,
    body: c.body,
    severity: c.severity,
  }));
}

/**
 * All currently-OPEN review findings for the caller's authorized installations,
 * projected to just what the Sensorium *pain* sensor needs (path + severity +
 * category). Scoped through the same `review.repository.installationId IN
 * installationIds` choke point as every other query here, so a finding from an
 * installation outside `installationIds` can never appear. Empty ids => `[]`.
 * Capped at 2000 rows — the map is a live overview, not an exhaustive audit.
 */
export async function getFindingsByPath(
  db: PrismaClient,
  installationIds: string[],
): Promise<FindingLike[]> {
  if (installationIds.length === 0) return [];
  return db.reviewComment.findMany({
    where: {
      review: { repository: { installationId: { in: installationIds } } },
      noiseState: 'OPEN',
    },
    select: { path: true, line: true, severity: true, category: true, body: true },
    take: 2000,
  });
}

export interface AgentEventData {
  minute: Date;
  count: number;
}

/**
 * Loads agent events per minute from the ClickHouse analytics backend.
 * Uses the events_per_minute Materialized View fast-path.
 */
export async function getAgentEventsPerMinute(
  installationIds: string[],
  limitMinutes: number = 60
): Promise<AgentEventData[]> {
  if (installationIds.length === 0) return [];

  // project_id maps to installationId in Areté's schema adaptation
  const inClause = installationIds.map(id => `'${id}'`).join(', ');
  
  const result = await clickhouse.query({
    query: `
      SELECT
        minute,
        sum(c) as count
      FROM superlog.events_per_minute
      WHERE project_id IN (${inClause})
      GROUP BY minute
      ORDER BY minute DESC
      LIMIT ${limitMinutes}
    `,
    format: 'JSONEachRow',
  });

  const rows: any[] = await result.json();
  
  return rows.map(r => ({
    minute: new Date(r.minute),
    count: Number(r.count),
  })).reverse(); // chronological order
}
