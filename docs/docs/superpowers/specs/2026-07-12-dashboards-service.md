# Dashboards Service — Design Spec

**Date:** 2026-07-12
**Branch:** `feat/dashboards-service` (worktree off `feat/marble-ink-foundation`)
**Merge target:** `feat/marble-ink-foundation` (the chosen Marble & Ink UI). The
marble→main consolidation remains a separate, already-known task.

## Goal

A new **Dashboards** page/service in the Areté dashboard app that visualizes the
product's data pipeline — Superlog-inspired in *spirit* (composable-feeling
widgets, preset dashboards, a time-range control, a scope filter) but built in
our own style, on our own data, with **honest empty/zero states everywhere**.

## Approach

Curated **preset dashboards** rendered by a **reusable widget engine**, unifying
two real data sources:

1. **Internal review telemetry** — `Review` / `ReviewComment` data (reviews over
   time, findings by category & severity, risk-level breakdown, per-repo
   activity, recent reviews).
2. **External telemetry** — `TelemetrySnapshotRecord` metrics captured from
   genuinely-connected providers (Sentry / Vercel / Stripe / PostHog / GitHub
   Actions) at review time.

**No new DB tables and no drag-drop in v1.** The widget engine is the seam that
lets full user-composition (the Superlog model: create/configure/drag/save
widgets, template variables) layer on later without a rewrite. Full
composability is explicitly **out of scope** for v1.

## Global Constraints

- **Anti-fabrication (house standard):** Never fabricate data, counts, series,
  or "live" status. Every widget renders a real zero/empty state when its data
  is absent. External-telemetry widgets are **always** captioned "as of last
  review · {fetchedAt}" — never implied to be live.
- **Tenant isolation:** The page is `force-dynamic`, reads `auth()`, and scopes
  every query through `resolveSelectedInstallationIds(...)` →
  `repository: { installationId: { in } }`, identical to the Overview page. A
  review outside the caller's authorized installations must never appear.
- **Theme:** Marble & Ink warm-dark tokens only (`surface-*`, `accent-*`,
  `content-*`, `border-*`). Reuse existing primitives (`Card`, `Badge`,
  `Sparkline`, `CountUpValue`, `page-reveal`, `ActivityList`).
- **No heavy dependencies:** Charts are hand-built SVG, matching
  `components/dashboard/sparkline.tsx`. No charting library is added.
- **Testing convention:** vitest node env + `renderToStaticMarkup` (NOT React
  Testing Library), matching existing tests.
- **Framework note:** Next.js 16 (Turbopack). Follow existing route conventions
  in `app/(dashboard)/`.

## Architecture

```
app/(dashboard)/dashboards/page.tsx        (server, force-dynamic, auth+scope)
   └─ <DashboardsWorkspace/>                (client: tab state, time-range, scope)
        ├─ preset registry (Review Activity · Findings · Telemetry)
        └─ widget engine
             ├─ <Widget> shell (title · caption · honest empty state)
             ├─ <MetricWidget/>          big number + delta badge + sparkline
             ├─ <TimeseriesWidget/>      area/line over selected day-range
             ├─ <BarBreakdownWidget/>    horizontal category/severity/risk bars
             ├─ <TableWidget/>           recent reviews / findings rows
             └─ <TelemetryMetricWidget/> one metric from a snapshot (+ "as of")
```

Server fetches a single view model + raw timestamps; the client re-buckets
timestamps for the selected range (no extra queries per range change).

## Data Layer (`packages/dashboard/src/lib/queries.ts`)

Add one aggregator, `getDashboardsViewModel(db, installationIds)`, reusing
existing queries and adding two small `groupBy`s:

- **Reuse:** `getDashboardViewModel` internals (totalPrs, criticalBugs,
  recentReviews, weeklyDelta, `commentsByCategory`), `getTrendSeries` (raw
  review/repo timestamps for client re-bucketing), `getMasterGridSnapshots`
  (external telemetry), review-history `riskCounts` idiom.
- **New groupBy — findings by severity:**
  `db.reviewComment.groupBy({ by: ['severity'], where: { review: { repository: repoScope } }, _count: { severity: true } })`.
  Known value: `severity === 'error'` denotes critical (per existing
  `criticalBugs` query); the implementer confirms the full severity set from the
  webhook writer.
- **New groupBy — per-repo activity:**
  `db.review.groupBy({ by: ['repositoryId'], where: { repository: repoScope }, _count: { repositoryId: true } })`,
  joined to repository `fullName` for labels.
- **Risk-level breakdown:** `db.review.groupBy({ by: ['riskLevel'], where: { repository: repoScope }, _count: { riskLevel: true } })`.

Return type `DashboardsViewModel`:
- `{ hasAccess: false }` when zero authorized installations (drives the
  connect-a-repo empty state), OR
- `{ hasAccess: true, totalPrs, criticalBugs, recentReviews, weeklyDelta,
   reviewDates: Date[], byCategory: CategoryCount[], bySeverity: CategoryCount[],
   byRisk: CategoryCount[], byRepo: {fullName,count}[], latestReviews: ReviewSummary[],
   telemetry: TelemetryGridSnapshot[] }`.

All timestamps returned raw (`Date[]`) so the client controls bucketing.

## Widget Engine (`components/dashboard/dashboards/`)

- **`widget.tsx`** — `<Widget title caption emptyLabel isEmpty>{children}</Widget>`
  shell: Card wrapper, header, optional caption, and a centered honest empty
  state when `isEmpty`. Every widget type composes this.
- **`metric-widget.tsx`** — reuses the `MetricsGrid` card idiom (big number via
  `CountUpValue`, optional `Badge` delta, optional `Sparkline`). Delta badge
  only renders when an honest change exists.
- **`timeseries-widget.tsx`** — area/line chart from a `number[]` day-bucket
  series (built with `bucketByDay`), sized larger than the sparkline; hand-built
  SVG. Empty state when the series sums to 0.
- **`bar-breakdown-widget.tsx`** — horizontal bars from `CategoryCount[]`
  (category / severity / risk), each bar width proportional to the max. Severity
  and risk use semantic accent colors. Empty state when list is empty.
- **`table-widget.tsx`** — thin wrapper over the existing `ActivityList` idiom
  for recent reviews; a findings variant lists path·line·severity·category.
- **`telemetry-metric-widget.tsx`** — renders numeric metrics from a
  `TelemetryGridSnapshot` (`metrics: Record<string,number>`), each captioned
  with provider + `fetchedAt` ("as of last review"). Never implies live.

## Preset Dashboards (`components/dashboard/dashboards/presets/`)

Tabbed, matching the approved mock:

1. **Review Activity** — reviews-over-time (Timeseries) · PRs reviewed (Metric) ·
   reviews this week (Metric + weekly delta) · per-repo activity (Bar) · recent
   reviews (Table).
2. **Findings** — by category (Bar) · by severity (Bar) · risk-level breakdown
   (Bar) · critical caught (Metric) · findings table (Table).
3. **Telemetry** — one panel per **genuinely-connected** provider showing its
   latest snapshot metrics (TelemetryMetricWidget). When no provider is
   connected: honest empty state — "Connect a provider on Connections →".

## Controls

- **`DashboardsWorkspace` (client)** owns: active preset tab, time-range
  (7 / 30 / 90 days, default 30), and scope.
- **Time-range picker** — a small segmented control; re-buckets the
  server-provided `reviewDates` client-side. Purely reslices real data.
- **Scope selector** — reuses the existing `InstallationSwitcher` (our analog to
  Superlog template variables). Custom template variables are out of scope.

## Routing & Nav

- Route: `app/(dashboard)/dashboards/page.tsx` — `export const dynamic = "force-dynamic"`, mirrors Overview's auth/scope preamble.
- `components/dashboard/sidebar.tsx` — add `{ href: "/dashboards", label: "Dashboards" }` to `NAV_ITEMS` (after Overview).
- `components/dashboard/topbar.tsx` — add `"/dashboards": "Dashboards"` to `BREADCRUMB_LABELS`.

## Testing

- `queries.test.ts` — extend with `getDashboardsViewModel`: tenant scoping,
  `hasAccess:false` on empty installations, correct groupBy shaping.
- Widget render tests (`renderToStaticMarkup`): each widget renders its data AND
  its honest empty state; `TelemetryMetricWidget` always includes the "as of"
  caption; delta badge omitted when no change.
- Preset render tests: each preset renders with real data and with all-empty
  data (no fabricated content, empty states present).

## Out of Scope (v1)

- User-composed dashboards (create/add/configure/drag/resize/save widgets).
- New Prisma models (Dashboard, DashboardWidget) and a persistence API.
- Custom template variables beyond the existing installation scope.
- MCP tools for programmatic dashboard management.
- Live telemetry fetches (v1 uses the last-review snapshot, honestly captioned).

## File Structure

```
Create:
  app/(dashboard)/dashboards/page.tsx
  components/dashboard/dashboards/dashboards-workspace.tsx
  components/dashboard/dashboards/widget.tsx
  components/dashboard/dashboards/metric-widget.tsx
  components/dashboard/dashboards/timeseries-widget.tsx
  components/dashboard/dashboards/bar-breakdown-widget.tsx
  components/dashboard/dashboards/table-widget.tsx
  components/dashboard/dashboards/telemetry-metric-widget.tsx
  components/dashboard/dashboards/time-range-control.tsx
  components/dashboard/dashboards/presets/review-activity.tsx
  components/dashboard/dashboards/presets/findings.tsx
  components/dashboard/dashboards/presets/telemetry.tsx
Modify:
  lib/queries.ts                    (+ getDashboardsViewModel, 3 groupBys)
  lib/queries.test.ts               (+ getDashboardsViewModel tests)
  components/dashboard/sidebar.tsx   (+ nav item)
  components/dashboard/topbar.tsx    (+ breadcrumb label)
```
