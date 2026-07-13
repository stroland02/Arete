# Dashboards Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `/dashboards` page to the Areté dashboard app: 3 curated preset dashboards (Review Activity · Findings · Telemetry) rendered by a reusable widget engine, unifying internal review data and connected external telemetry, with honest empty states throughout.

**Architecture:** A `force-dynamic` server route fetches one tenant-scoped view model (`getDashboardsViewModel`) plus raw review timestamps. A client `DashboardsWorkspace` owns preset-tab + time-range state and re-buckets timestamps client-side. Presets compose pure presentational widgets (metric/timeseries/bar/table/telemetry-metric) built with hand-rolled SVG.

**Tech Stack:** Next.js 16 (Turbopack), React 19, Prisma 7 (`@arete/db`), Auth.js v5, framer-motion, Tailwind (Marble & Ink warm-dark tokens), `@tabler/icons-react`, vitest + `renderToStaticMarkup`.

## Global Constraints

- **Anti-fabrication:** No fabricated data/series/"live" status. Every widget renders a real zero/empty state when data is absent. Telemetry widgets ALWAYS caption "as of last review · {fetchedAt}".
- **Tenant isolation:** `force-dynamic`; `auth()`; every query scoped via `resolveSelectedInstallationIds` → `repository: { installationId: { in } }`. Identical to `overview/page.tsx`.
- **Theme tokens only:** `surface-*`, `accent-*`, `content-*`, `border-*`. Reuse `Card`, `Badge`, `Sparkline`, `CountUpValue`, `EmptyState`, `PageReveal`/`RevealItem`.
- **No new dependencies. No new Prisma models.** Charts are hand-built SVG (see `components/dashboard/sparkline.tsx`).
- **Severity values are exactly `'info' | 'warning' | 'error'`** (`packages/webhook/src/types.ts`), `error` = critical. **Risk levels** seen in UI: `critical | high | medium | low`.
- **Tests:** vitest node env, `renderToStaticMarkup` (NOT React Testing Library).
- **Path alias:** `@/` → `packages/dashboard/src/`.

## File Structure

```
Create:
  packages/dashboard/src/app/(dashboard)/dashboards/page.tsx
  packages/dashboard/src/components/dashboard/dashboards/dashboards-workspace.tsx
  packages/dashboard/src/components/dashboard/dashboards/time-range-control.tsx
  packages/dashboard/src/components/dashboard/dashboards/widget.tsx
  packages/dashboard/src/components/dashboard/dashboards/metric-widget.tsx
  packages/dashboard/src/components/dashboard/dashboards/timeseries-widget.tsx
  packages/dashboard/src/components/dashboard/dashboards/bar-breakdown-widget.tsx
  packages/dashboard/src/components/dashboard/dashboards/table-widget.tsx
  packages/dashboard/src/components/dashboard/dashboards/telemetry-metric-widget.tsx
  packages/dashboard/src/components/dashboard/dashboards/presets/review-activity.tsx
  packages/dashboard/src/components/dashboard/dashboards/presets/findings.tsx
  packages/dashboard/src/components/dashboard/dashboards/presets/telemetry.tsx
  packages/dashboard/src/components/dashboard/dashboards/widgets.test.tsx
  packages/dashboard/src/components/dashboard/dashboards/presets.test.tsx
Modify:
  packages/dashboard/src/lib/queries.ts
  packages/dashboard/src/lib/queries.test.ts
  packages/dashboard/src/components/dashboard/sidebar.tsx
  packages/dashboard/src/components/dashboard/topbar.tsx
```

---

### Task 1: Data layer — `getDashboardsViewModel`

**Files:**
- Modify: `packages/dashboard/src/lib/queries.ts` (append new interfaces + function; do not touch existing exports)
- Test: `packages/dashboard/src/lib/queries.test.ts` (extend the in-memory fake db + add a describe block)

**Interfaces:**
- Consumes: existing `CategoryCount`, `ReviewSummary`, `TelemetryGridSnapshot` types already in this file; `PrismaClient` from `@arete/db`.
- Produces: `RepoActivity`, `DashboardsViewModel`, `getDashboardsViewModel(db, installationIds): Promise<DashboardsViewModel>`.

- [ ] **Step 1: Write the failing test**

Append the describe block below to `packages/dashboard/src/lib/queries.test.ts`. It exercises the zero-installations short-circuit and tenant-scoped shaping.

```ts
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
```

Also add `getDashboardsViewModel` to the import list at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/dashboard && pnpm vitest run src/lib/queries.test.ts -t "getDashboardsViewModel"`
Expected: FAIL — `getDashboardsViewModel is not exported` / fake db `review.groupBy is not a function`.

- [ ] **Step 3: Extend the fake db in `queries.test.ts`**

Inside `createFakeDb`, add `groupBy` to the `review` mock and `by:['severity']` support to the `reviewComment.groupBy` mock. Reuse the existing `reviewMatchesRepoScope` / `reviewById` helpers already in the file (they back the existing category groupBy). Merge these keys into the existing mock objects — do NOT duplicate them.

```ts
    review: {
      // ...keep existing count + findMany...
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
      // ...keep existing count...
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
```

- [ ] **Step 4: Implement `getDashboardsViewModel` in `queries.ts`**

Append to `packages/dashboard/src/lib/queries.ts`:

```ts
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
    db.review.groupBy({ by: ['riskLevel'], where: reviewScope, _count: { riskLevel: true } }),
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
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/dashboard && pnpm vitest run src/lib/queries.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 6: Typecheck & commit**

Run: `cd packages/dashboard && pnpm tsc --noEmit` → exit 0.

```bash
git add packages/dashboard/src/lib/queries.ts packages/dashboard/src/lib/queries.test.ts
git commit -m "feat(dashboards): getDashboardsViewModel tenant-scoped aggregate"
```

---

### Task 2: Widget engine

**Files:**
- Create: `widget.tsx`, `metric-widget.tsx`, `timeseries-widget.tsx`, `bar-breakdown-widget.tsx`, `table-widget.tsx`, `telemetry-metric-widget.tsx` (all in `components/dashboard/dashboards/`)
- Test: `components/dashboard/dashboards/widgets.test.tsx`

**Interfaces:**
- Consumes: `CategoryCount`, `ReviewSummary`, `TelemetryGridSnapshot`, `RepoActivity` from `@/lib/queries`; `bucketByDay` from `@/lib/trends`; `Card`, `Badge`, `Sparkline`, `CountUpValue`, `EmptyState`, `ActivityList` + `ActivityItem`.
- Produces: `Widget`, `MetricWidget`, `TimeseriesWidget`, `BarBreakdownWidget`, `TableWidget`, `TelemetryMetricWidget`.

- [ ] **Step 1: Write the failing render tests**

Create `components/dashboard/dashboards/widgets.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Widget } from './widget';
import { BarBreakdownWidget } from './bar-breakdown-widget';
import { TimeseriesWidget } from './timeseries-widget';
import { TelemetryMetricWidget } from './telemetry-metric-widget';

describe('Widget shell', () => {
  it('renders the honest empty state when isEmpty', () => {
    const html = renderToStaticMarkup(
      <Widget title="Reviews" isEmpty emptyLabel="No reviews yet"><div>should-not-appear</div></Widget>
    );
    expect(html).toContain('No reviews yet');
    expect(html).not.toContain('should-not-appear');
  });
  it('renders children when not empty', () => {
    const html = renderToStaticMarkup(<Widget title="Reviews"><div>body-content</div></Widget>);
    expect(html).toContain('body-content');
  });
});

describe('BarBreakdownWidget', () => {
  it('renders a bar per row with labels and counts', () => {
    const html = renderToStaticMarkup(
      <BarBreakdownWidget title="By category" data={[{ category: 'security', count: 3 }, { category: 'performance', count: 1 }]} />
    );
    expect(html).toContain('security');
    expect(html).toContain('performance');
    expect(html).toContain('3');
  });
  it('shows an empty state for no data', () => {
    const html = renderToStaticMarkup(<BarBreakdownWidget title="By category" data={[]} />);
    expect(html).toContain('Nothing to show yet');
  });
});

describe('TimeseriesWidget', () => {
  it('renders an svg polyline for a non-empty series', () => {
    const html = renderToStaticMarkup(<TimeseriesWidget title="Reviews over time" dates={[new Date(), new Date()]} days={30} />);
    expect(html).toContain('<svg');
    expect(html).toContain('polyline');
  });
  it('shows an empty state when the series is all zero', () => {
    const html = renderToStaticMarkup(<TimeseriesWidget title="Reviews over time" dates={[]} days={30} />);
    expect(html).toContain('No activity in this range');
  });
});

describe('TelemetryMetricWidget', () => {
  it('always captions the snapshot with its fetched time (never implies live)', () => {
    const html = renderToStaticMarkup(
      <TelemetryMetricWidget snapshot={{ provider: 'sentry', sourceRef: 'acme/api', summaryText: 'ok', metrics: { error_rate: 2 }, links: [], fetchedAt: new Date('2026-07-10T00:00:00Z') }} />
    );
    expect(html.toLowerCase()).toContain('as of last review');
    expect(html).toContain('error_rate');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/dashboard && pnpm vitest run src/components/dashboard/dashboards/widgets.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `widget.tsx`**

```tsx
import type { ReactNode } from "react";
import { IconChartBar } from "@tabler/icons-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";

export interface WidgetProps {
  title: string;
  /** Small caption under the title (e.g. "as of last review"). */
  caption?: string;
  /** When true, render the honest empty state instead of children. */
  isEmpty?: boolean;
  emptyLabel?: string;
  /** Optional right-aligned header slot (badge, count). */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Widget({ title, caption, isEmpty, emptyLabel = "Nothing to show yet", action, className, children }: WidgetProps) {
  return (
    <Card className={className}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-content-primary">{title}</h3>
          {caption && <p className="mt-0.5 text-[11px] text-content-muted">{caption}</p>}
        </div>
        {action}
      </div>
      {isEmpty ? <EmptyState icon={<IconChartBar className="h-5 w-5" />} title={emptyLabel} /> : children}
    </Card>
  );
}
```

- [ ] **Step 4: Implement `metric-widget.tsx`**

```tsx
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CountUpValue } from "@/components/dashboard/count-up-value";
import { Sparkline } from "@/components/dashboard/sparkline";

export interface MetricWidgetProps {
  label: string;
  value: number;
  icon?: ReactNode;
  /** Honest delta string, e.g. "+3" or "-12.5%". Badge omitted when undefined. */
  change?: string;
  positive?: boolean;
  /** Optional day-bucket series for a sparkline. */
  trend?: number[];
}

export function MetricWidget({ label, value, icon, change, positive, trend }: MetricWidgetProps) {
  return (
    <Card className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between">
        {icon ? <div className="rounded-2xl border border-border-default bg-content-primary/5 p-3">{icon}</div> : <span />}
        {change && <Badge variant={positive ? "positive" : "negative"}>{change}</Badge>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-sm font-medium text-content-muted">{label}</p>
          <h3 className="font-mono text-3xl font-bold tabular-nums tracking-tight text-content-primary">
            <CountUpValue value={String(value)} />
          </h3>
        </div>
        {trend && trend.length > 1 && (
          <Sparkline data={trend} className="h-7 w-20 shrink-0" strokeClassName={positive === false ? "stroke-accent-danger" : "stroke-accent-primary"} />
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 5: Implement `timeseries-widget.tsx`**

Hand-built SVG area+line; `bucketByDay` converts dates → per-day counts.

```tsx
import { bucketByDay } from "@/lib/trends";
import { Widget } from "./widget";

export interface TimeseriesWidgetProps {
  title: string;
  caption?: string;
  dates: Date[];
  days: number;
}

const W = 600;
const H = 160;

export function TimeseriesWidget({ title, caption, dates, days }: TimeseriesWidgetProps) {
  const series = bucketByDay(dates, days);
  const total = series.reduce((a, b) => a + b, 0);

  if (total === 0) {
    return (
      <Widget title={title} caption={caption} isEmpty emptyLabel="No activity in this range"><span /></Widget>
    );
  }

  const max = Math.max(...series, 1);
  const stepX = series.length > 1 ? W / (series.length - 1) : 0;
  const points = series.map((v, i) => {
    const x = i * stepX;
    const y = H - (v / max) * (H - 12) - 6;
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  return (
    <Widget title={title} caption={caption} action={<span className="font-mono text-xs text-content-muted">{total} total</span>}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label={`${title}: ${total} total`}>
        <polygon points={area} className="fill-accent-primary/10" />
        <polyline points={line} fill="none" className="stroke-accent-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Widget>
  );
}
```

- [ ] **Step 6: Implement `bar-breakdown-widget.tsx`**

```tsx
import type { CategoryCount } from "@/lib/queries";
import { Widget } from "./widget";

export interface BarBreakdownWidgetProps {
  title: string;
  caption?: string;
  data: CategoryCount[];
  /** Map a row label to a bar color class; defaults to accent-primary. */
  colorFor?: (label: string) => string;
}

export function BarBreakdownWidget({ title, caption, data, colorFor }: BarBreakdownWidgetProps) {
  if (data.length === 0) {
    return <Widget title={title} caption={caption} isEmpty emptyLabel="Nothing to show yet"><span /></Widget>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <Widget title={title} caption={caption}>
      <ul className="space-y-3">
        {data.map((row) => (
          <li key={row.category}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium capitalize text-content-secondary">{row.category}</span>
              <span className="font-mono text-xs tabular-nums text-content-muted">{row.count}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full rounded-full ${colorFor ? colorFor(row.category) : "bg-accent-primary"}`} style={{ width: `${(row.count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Widget>
  );
}
```

- [ ] **Step 7: Implement `table-widget.tsx`**

```tsx
import type { ReviewSummary } from "@/lib/queries";
import { Widget } from "./widget";
import { ActivityList, type ActivityItem } from "@/components/dashboard/activity-list";

export interface TableWidgetProps {
  title: string;
  reviews: ReviewSummary[];
}

export function TableWidget({ title, reviews }: TableWidgetProps) {
  const items: ActivityItem[] = reviews.map((r) => ({
    id: r.id,
    repositoryName: r.repositoryFullName,
    prNumber: r.prNumber,
    createdAt: r.createdAt.toISOString(),
    riskLevel: r.riskLevel,
  }));
  return (
    <Widget title={title} isEmpty={items.length === 0} emptyLabel="No reviews yet">
      <ActivityList reviews={items} />
    </Widget>
  );
}
```

- [ ] **Step 8: Implement `telemetry-metric-widget.tsx`**

```tsx
import type { TelemetryGridSnapshot } from "@/lib/queries";
import { Widget } from "./widget";

export interface TelemetryMetricWidgetProps {
  snapshot: TelemetryGridSnapshot;
}

export function TelemetryMetricWidget({ snapshot }: TelemetryMetricWidgetProps) {
  const entries = Object.entries(snapshot.metrics ?? {});
  const caption = `as of last review · ${snapshot.fetchedAt.toLocaleDateString()}`;

  return (
    <Widget
      title={snapshot.provider}
      caption={caption}
      isEmpty={entries.length === 0}
      emptyLabel="No metrics captured yet"
      action={<span className="font-mono text-[11px] text-content-muted">{snapshot.sourceRef}</span>}
    >
      <dl className="grid grid-cols-2 gap-3">
        {entries.map(([key, val]) => (
          <div key={key} className="rounded-xl border border-border-subtle bg-surface-0/40 p-3">
            <dt className="truncate text-[11px] text-content-muted">{key}</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-content-primary">{val}</dd>
          </div>
        ))}
      </dl>
    </Widget>
  );
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd packages/dashboard && pnpm vitest run src/components/dashboard/dashboards/widgets.test.tsx`
Expected: PASS.

- [ ] **Step 10: Typecheck & commit**

Run: `cd packages/dashboard && pnpm tsc --noEmit` → exit 0.

```bash
git add packages/dashboard/src/components/dashboard/dashboards/
git commit -m "feat(dashboards): reusable widget engine (metric/timeseries/bar/table/telemetry)"
```

---

### Task 3: Preset dashboards

**Files:**
- Create: `presets/review-activity.tsx`, `presets/findings.tsx`, `presets/telemetry.tsx`
- Test: `components/dashboard/dashboards/presets.test.tsx`

**Interfaces:**
- Consumes: `DashboardsViewModel` (the `hasAccess: true` branch) from `@/lib/queries`; all Task 2 widgets.
- Produces: `ReviewActivityPreset`, `FindingsPreset`, `TelemetryPreset` — each takes `{ model: Extract<DashboardsViewModel, { hasAccess: true }>; days: number }` (findings/telemetry ignore `days`).

- [ ] **Step 1: Write the failing preset tests**

Create `presets.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewActivityPreset } from './presets/review-activity';
import { FindingsPreset } from './presets/findings';
import { TelemetryPreset } from './presets/telemetry';

type Model = Parameters<typeof ReviewActivityPreset>[0]['model'];

const emptyModel: Model = {
  hasAccess: true, totalPrs: 0, criticalBugs: 0, recentReviews: 0, weeklyDelta: 0,
  reviewDates: [], byCategory: [], bySeverity: [], byRisk: [], byRepo: [], latestReviews: [], telemetry: [],
};

const fullModel: Model = {
  ...emptyModel,
  totalPrs: 5, criticalBugs: 2, recentReviews: 3, weeklyDelta: 1,
  reviewDates: [new Date(), new Date()],
  byCategory: [{ category: 'security', count: 4 }],
  bySeverity: [{ category: 'error', count: 2 }, { category: 'warning', count: 1 }],
  byRisk: [{ category: 'high', count: 3 }],
  byRepo: [{ fullName: 'acme/api', count: 5 }],
  latestReviews: [{ id: 'v1', prNumber: 1, riskLevel: 'high', createdAt: new Date(), repositoryFullName: 'acme/api' }],
};

describe('ReviewActivityPreset', () => {
  it('renders real metrics with data', () => {
    const html = renderToStaticMarkup(<ReviewActivityPreset model={fullModel} days={30} />);
    expect(html).toContain('acme/api');
    expect(html).toContain('Pull requests reviewed');
  });
  it('renders honest empty states with no data', () => {
    const html = renderToStaticMarkup(<ReviewActivityPreset model={emptyModel} days={30} />);
    expect(html).toContain('No reviews yet');
  });
});

describe('FindingsPreset', () => {
  it('renders severity + category breakdowns with data', () => {
    const html = renderToStaticMarkup(<FindingsPreset model={fullModel} days={30} />);
    expect(html).toContain('security');
    expect(html.toLowerCase()).toContain('error');
  });
  it('renders empty states with no data', () => {
    const html = renderToStaticMarkup(<FindingsPreset model={emptyModel} days={30} />);
    expect(html).toContain('Nothing to show yet');
  });
});

describe('TelemetryPreset', () => {
  it('shows the connect-a-provider empty state when nothing is connected', () => {
    const html = renderToStaticMarkup(<TelemetryPreset model={emptyModel} days={30} />);
    expect(html.toLowerCase()).toContain('connect a provider');
  });
  it('renders one panel per connected provider', () => {
    const html = renderToStaticMarkup(
      <TelemetryPreset model={{ ...emptyModel, telemetry: [{ provider: 'sentry', sourceRef: 'acme/api', summaryText: '', metrics: { error_rate: 2 }, links: [], fetchedAt: new Date() }] }} days={30} />
    );
    expect(html).toContain('sentry');
    expect(html.toLowerCase()).toContain('as of last review');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/dashboard && pnpm vitest run src/components/dashboard/dashboards/presets.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `presets/review-activity.tsx`**

```tsx
import type { DashboardsViewModel } from "@/lib/queries";
import { IconGitPullRequest, IconClockHour4 } from "@tabler/icons-react";
import { MetricWidget } from "../metric-widget";
import { TimeseriesWidget } from "../timeseries-widget";
import { BarBreakdownWidget } from "../bar-breakdown-widget";
import { TableWidget } from "../table-widget";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

export function ReviewActivityPreset({ model, days }: { model: Model; days: number }) {
  const weekChange = model.weeklyDelta === 0 ? undefined : `${model.weeklyDelta > 0 ? "+" : ""}${model.weeklyDelta}`;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <TimeseriesWidget title="Reviews over time" caption={`last ${days} days`} dates={model.reviewDates} days={days} />
      </div>
      <MetricWidget label="Pull requests reviewed" value={model.totalPrs} icon={<IconGitPullRequest className="h-5 w-5 text-accent-primary" />} />
      <MetricWidget label="Reviews this week" value={model.recentReviews} icon={<IconClockHour4 className="h-5 w-5 text-accent-secondary" />} change={weekChange} positive={model.weeklyDelta >= 0} />
      <BarBreakdownWidget title="Activity by repository" data={model.byRepo.map((r) => ({ category: r.fullName, count: r.count }))} />
      <TableWidget title="Recent reviews" reviews={model.latestReviews} />
    </div>
  );
}
```

- [ ] **Step 4: Implement `presets/findings.tsx`**

```tsx
import type { DashboardsViewModel } from "@/lib/queries";
import { IconShieldExclamation } from "@tabler/icons-react";
import { MetricWidget } from "../metric-widget";
import { BarBreakdownWidget } from "../bar-breakdown-widget";
import { TableWidget } from "../table-widget";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

function severityColor(label: string): string {
  switch (label.toLowerCase()) {
    case "error": return "bg-accent-danger";
    case "warning": return "bg-accent-warning";
    default: return "bg-accent-primary";
  }
}
function riskColor(label: string): string {
  switch (label.toLowerCase()) {
    case "critical":
    case "high": return "bg-accent-danger";
    case "medium": return "bg-accent-warning";
    case "low": return "bg-accent-success";
    default: return "bg-content-muted";
  }
}

export function FindingsPreset({ model }: { model: Model; days: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <MetricWidget label="Critical issues caught" value={model.criticalBugs} icon={<IconShieldExclamation className="h-5 w-5 text-accent-danger" />} />
      <BarBreakdownWidget title="Findings by severity" data={model.bySeverity} colorFor={severityColor} />
      <BarBreakdownWidget title="Findings by category" data={model.byCategory} />
      <BarBreakdownWidget title="Risk-level breakdown" data={model.byRisk} colorFor={riskColor} />
      <div className="lg:col-span-2">
        <TableWidget title="Recent reviews" reviews={model.latestReviews} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `presets/telemetry.tsx`**

```tsx
import Link from "next/link";
import type { DashboardsViewModel } from "@/lib/queries";
import { IconPlugConnected, IconArrowRight } from "@tabler/icons-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TelemetryMetricWidget } from "../telemetry-metric-widget";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

export function TelemetryPreset({ model }: { model: Model; days: number }) {
  if (model.telemetry.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<IconPlugConnected className="h-6 w-6" />}
          title="No telemetry connected yet"
          description="Connect a provider to see its latest metrics here — captured at each review."
        />
        <div className="mt-4 flex justify-center">
          <Link href="/connections" className="inline-flex items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/30">
            Connect a provider <IconArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {model.telemetry.map((snap) => (
        <TelemetryMetricWidget key={`${snap.provider}:${snap.sourceRef}`} snapshot={snap} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/dashboard && pnpm vitest run src/components/dashboard/dashboards/presets.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck & commit**

Run: `cd packages/dashboard && pnpm tsc --noEmit` → exit 0.

```bash
git add packages/dashboard/src/components/dashboard/dashboards/presets/ packages/dashboard/src/components/dashboard/dashboards/presets.test.tsx
git commit -m "feat(dashboards): Review Activity, Findings, Telemetry presets"
```

---

### Task 4: Workspace, route & nav

**Files:**
- Create: `dashboards-workspace.tsx`, `time-range-control.tsx`, `app/(dashboard)/dashboards/page.tsx`
- Modify: `components/dashboard/sidebar.tsx`, `components/dashboard/topbar.tsx`

**Interfaces:**
- Consumes: `getDashboardsViewModel`, `resolveSelectedInstallationIds` from `@/lib/queries`; `auth`, `db`; the three presets.
- Produces: the live `/dashboards` route + nav entry.

- [ ] **Step 1: Implement `time-range-control.tsx`**

```tsx
"use client";

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

export function TimeRangeControl({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border-default bg-surface-1 p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            value === r ? "bg-content-primary/10 text-content-primary" : "text-content-muted hover:text-content-secondary"
          }`}
        >
          {r}d
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement `dashboards-workspace.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { DashboardsViewModel } from "@/lib/queries";
import { ReviewActivityPreset } from "./presets/review-activity";
import { FindingsPreset } from "./presets/findings";
import { TelemetryPreset } from "./presets/telemetry";
import { TimeRangeControl, type Range } from "./time-range-control";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

const PRESETS = [
  { key: "activity", label: "Review Activity", Component: ReviewActivityPreset },
  { key: "findings", label: "Findings", Component: FindingsPreset },
  { key: "telemetry", label: "Telemetry", Component: TelemetryPreset },
] as const;

export function DashboardsWorkspace({ model }: { model: Model }) {
  const [tab, setTab] = useState<(typeof PRESETS)[number]["key"]>("activity");
  const [range, setRange] = useState<Range>(30);
  const Active = PRESETS.find((p) => p.key === tab)!.Component;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setTab(p.key)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === p.key ? "border border-border-default bg-content-primary/10 text-content-primary" : "text-content-muted hover:text-content-secondary hover:bg-content-primary/[0.03]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {tab !== "telemetry" && <TimeRangeControl value={range} onChange={setRange} />}
      </div>
      <Active model={model} days={range} />
    </div>
  );
}
```

- [ ] **Step 3: Implement `app/(dashboard)/dashboards/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { IconArrowRight, IconLayoutDashboard } from "@tabler/icons-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDashboardsViewModel, resolveSelectedInstallationIds } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DashboardsWorkspace } from "@/components/dashboard/dashboards/dashboards-workspace";

export const dynamic = "force-dynamic";

export default async function DashboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { installation } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], installation);
  const model = await getDashboardsViewModel(db, installationIds);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold text-content-primary">Dashboards</h1>
        <p className="text-sm text-content-muted">Your review pipeline and connected telemetry, at a glance.</p>
      </div>

      {model.hasAccess ? (
        <DashboardsWorkspace model={model} />
      ) : (
        <Card>
          <EmptyState
            icon={<IconLayoutDashboard className="h-6 w-6" />}
            title="No data yet"
            description="Connect a repository — once Areté reviews a pull request, your dashboards fill in automatically."
          />
          <div className="mt-4 flex justify-center">
            <Link href="/connections" className="inline-flex items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/30">
              Connect a repository <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the nav item (`sidebar.tsx`)**

In `NAV_ITEMS`, insert `{ href: "/dashboards", label: "Dashboards" }` immediately after the Overview entry:

```ts
const NAV_ITEMS = [
  { href: "/overview", label: "Overview" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/agents", label: "Agents" },
  { href: "/connections", label: "Connections" },
  { href: "/history", label: "Review History" },
  { href: "/settings", label: "Settings" },
];
```

- [ ] **Step 5: Add the breadcrumb label (`topbar.tsx`)**

In `BREADCRUMB_LABELS`, add `"/dashboards": "Dashboards",` after the `"/overview"` entry.

- [ ] **Step 6: Verify route compiles & is gated**

Run: `cd packages/dashboard && pnpm tsc --noEmit` → exit 0.
Start dev on the worktree's port and confirm `curl -sI http://localhost:<port>/dashboards` → `307` (redirect to /login when unauthenticated), matching every other `(dashboard)` route. Do NOT commit `.env`.

- [ ] **Step 7: Run the full dashboard test suite**

Run: `cd packages/dashboard && pnpm vitest run`
Expected: PASS (existing + all new dashboards tests).

- [ ] **Step 8: Commit**

```bash
git add "packages/dashboard/src/app/(dashboard)/dashboards/" packages/dashboard/src/components/dashboard/dashboards/dashboards-workspace.tsx packages/dashboard/src/components/dashboard/dashboards/time-range-control.tsx packages/dashboard/src/components/dashboard/sidebar.tsx packages/dashboard/src/components/dashboard/topbar.tsx
git commit -m "feat(dashboards): /dashboards route, workspace, time-range control + nav"
```

---

## Self-Review Notes (author)

- **Spec coverage:** data layer + tenant scoping + honest empty states (T1), widget engine (T2), 3 presets (T3), time-range control + route + nav (T4). All spec sections mapped.
- **Type consistency:** `DashboardsViewModel` defined in T1; consumed in T2/T3/T4 via `Extract<…, { hasAccess: true }>`. `CategoryCount` reused for category/severity/risk. `RepoActivity` mapped to `CategoryCount` at the preset boundary for `BarBreakdownWidget`.
- **Honesty:** every widget has an empty state; `TelemetryMetricWidget` hard-codes the "as of last review" caption; page + telemetry preset show connect-CTA empty states; no fabricated numbers anywhere.
- **Scope discipline:** no new deps, no Prisma migration, no drag-drop, no template-variable engine — all deferred per spec "Out of Scope".
```
