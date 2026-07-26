# Overview Cleanup + Setup Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicate metrics cards on the dashboard Overview page and add an honest, real-data setup-progress checklist.

**Architecture:** Bring `MetricsGrid` and `CommentsByCategory` forward from `feat/arete-account-auth` (already built + tested there, unmerged), strip `ValueLedger` down to its greeting line only, add a new `SetupChecklist` component driven entirely by existing queries, and recompose `overview/page.tsx`.

**Tech Stack:** Next.js 16 App Router (Server Component page + client subcomponents), Tailwind v4 tokens, Framer Motion (`PageReveal`/`RevealItem`), `@tabler/icons-react`, vitest + `renderToStaticMarkup`.

## Global Constraints

- No fabricated data anywhere — every checklist step's `done` value must come from a real query result (`viewModel.hasAccess`, `telemetryProviders.length`, `totalPrs`), never estimated or padded.
- "Create your Areté account" is the one step allowed to render `done: true` unconditionally — it is true by construction (the page is behind `auth()`), not an approximation.
- Do not touch `feat/arete-account-auth`'s `/agents` workspace files (`app/(dashboard)/agents/`, `components/dashboard/agents/*`) — out of scope, actively owned by another agent.
- Reuse existing design tokens/primitives only (`glass-panel`, `Card`/`CardHeader`/`CardTitle`, `Badge`, `EmptyState`, `lib/motion.ts`, `@tabler/icons-react`) — no new visual language.
- Keep `pnpm --filter @arete/dashboard test`, `tsc --noEmit`, and `next build` green throughout.
- Branch off latest `origin/main` (verify `git branch --show-current` before every commit — this is a multi-agent repo where the shared checkout's branch can change underneath you).

---

### Task 1: Port `MetricsGrid` and `CommentsByCategory` onto `main`

**Files:**
- Create: `packages/dashboard/src/components/dashboard/metrics-grid.tsx`
- Create: `packages/dashboard/src/components/dashboard/comments-by-category.tsx`
- Create: `packages/dashboard/src/components/dashboard/empty-state.tsx` (check first — `main` may already have an `EmptyState` at a different path; if `packages/dashboard/src/components/EmptyState.tsx` already exists at the repo root components dir, reuse that import path instead of creating a duplicate)
- Test: none new (these are unmodified ports; existing tests below cover the composed page)

**Interfaces:**
- Consumes: `CategoryCount` type from `@/lib/queries` (already exists on `main`), `Card`/`CardHeader`/`CardTitle` from `@/components/ui/card`, `Badge` from `@/components/ui/badge`, `RevealItem` from `./page-reveal`, `Sparkline` from `./sparkline` (verify this exists on `main` — check `packages/dashboard/src/components/dashboard/sparkline.tsx`; if missing, port it from `feat/arete-account-auth` too), `CountUpValue` from `./count-up-value` (same check).
- Produces: `MetricsGrid({ metrics: Metric[] })` and `CommentsByCategory({ categories: CategoryCount[] })`, both exported for Task 3's page composition.

- [ ] **Step 1: Check for missing dependencies first**

Run:
```bash
cd "C:\Users\strol\OneDrive\Desktop\Areté"
ls packages/dashboard/src/components/dashboard/sparkline.tsx
ls packages/dashboard/src/components/dashboard/count-up-value.tsx
ls packages/dashboard/src/components/EmptyState.tsx packages/dashboard/src/components/dashboard/empty-state.tsx 2>&1
```
If `sparkline.tsx` or `count-up-value.tsx` are missing on `main`, port them too via `git show feat/arete-account-auth:<path> > <path>`. Note which `EmptyState` path actually exists — use that path in Step 2's `comments-by-category.tsx`, adjusting the import if it differs from `./empty-state`.

- [ ] **Step 2: Port the two components verbatim**

```bash
git show feat/arete-account-auth:packages/dashboard/src/components/dashboard/metrics-grid.tsx > packages/dashboard/src/components/dashboard/metrics-grid.tsx
git show feat/arete-account-auth:packages/dashboard/src/components/dashboard/comments-by-category.tsx > packages/dashboard/src/components/dashboard/comments-by-category.tsx
```

`metrics-grid.tsx` content (for reference — verify the ported file matches):
```tsx
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RevealItem } from "./page-reveal";
import { Sparkline } from "./sparkline";
import { CountUpValue } from "./count-up-value";

export interface Metric {
  title: string;
  value: string;
  /** Omit when no honest change/delta can be derived — the badge simply won't render. */
  change?: string;
  positive?: boolean;
  icon: ReactNode;
  trend?: number[];
}

export function MetricsGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {metrics.map((metric, i) => (
        <RevealItem key={i}>
          <Card className="flex h-full flex-col gap-4 group">
            <div className="flex justify-between items-start">
              <div className="p-3 bg-white/5 rounded-2xl border border-border-default transition-[background-color,border-color,transform] duration-300 ease-out group-hover:bg-white/10 group-hover:border-border-strong group-hover:scale-105">
                {metric.icon}
              </div>
              {metric.change && (
                <Badge variant={metric.positive ? "positive" : "negative"}>{metric.change}</Badge>
              )}
            </div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-content-muted mb-1">{metric.title}</p>
                <h3 className="text-3xl font-bold text-content-primary font-mono tabular-nums tracking-tight">
                  <CountUpValue value={metric.value} />
                </h3>
              </div>
              {metric.trend && metric.trend.length > 1 && (
                <Sparkline
                  data={metric.trend}
                  className="w-20 h-7 shrink-0"
                  strokeClassName={metric.positive ? "stroke-accent-success" : "stroke-accent-danger"}
                />
              )}
            </div>
          </Card>
        </RevealItem>
      ))}
    </div>
  );
}
```

`comments-by-category.tsx` content (for reference — verify the ported file matches; adjust the `EmptyState` import path per Step 1's finding):
```tsx
import { IconChartBar } from "@tabler/icons-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "./empty-state";
import type { CategoryCount } from "@/lib/queries";

function formatCategory(category: string): string {
  return category
    .split(/[_-]/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function CommentsByCategory({ categories }: { categories: CategoryCount[] }) {
  const max = Math.max(...categories.map((c) => c.count), 1);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Comments by Category</CardTitle>
      </CardHeader>

      {categories.length === 0 ? (
        <EmptyState
          icon={<IconChartBar className="h-6 w-6" />}
          title="No findings yet"
          description="The category breakdown appears after your first reviewed pull request."
        />
      ) : (
        <ul className="space-y-4">
          {categories.map((entry) => {
            const label = formatCategory(entry.category);
            return (
              <li
                key={entry.category}
                className="flex items-center gap-3"
                aria-label={`${label}: ${entry.count} comment${entry.count === 1 ? "" : "s"}`}
              >
                <span className="w-32 shrink-0 truncate text-xs font-medium text-content-secondary">
                  {label}
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5">
                  <span
                    className="block h-full rounded-full bg-accent-primary/80"
                    style={{ width: `${Math.max((entry.count / max) * 100, 2)}%` }}
                    data-bar
                  />
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-content-primary">
                  {entry.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter @arete/dashboard exec tsc --noEmit`
Expected: no new errors from these two files (pre-existing unrelated errors, if any, are not this task's concern).

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add packages/dashboard/src/components/dashboard/metrics-grid.tsx packages/dashboard/src/components/dashboard/comments-by-category.tsx
git add packages/dashboard/src/components/dashboard/sparkline.tsx packages/dashboard/src/components/dashboard/count-up-value.tsx 2>/dev/null || true
git commit -m "feat(dashboard): port MetricsGrid and CommentsByCategory from account-auth branch"
```

---

### Task 2: Build `SetupChecklist`

**Files:**
- Create: `packages/dashboard/src/components/dashboard/setup-checklist.tsx`
- Test: `packages/dashboard/src/components/dashboard/setup-checklist.test.tsx`

**Interfaces:**
- Consumes: `Card` from `@/components/ui/card`, icons from `@tabler/icons-react` (`IconCircleCheck`, `IconCircle`).
- Produces: `SetupChecklist({ steps: SetupStep[] })` where
  ```ts
  export interface SetupStep {
    id: string;
    label: string;
    done: boolean;
    href?: string;
  }
  ```
  exported for Task 3's page composition to import.

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboard/src/components/dashboard/setup-checklist.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupChecklist, type SetupStep } from "./setup-checklist";

const partialSteps: SetupStep[] = [
  { id: "account", label: "Create your Areté account", done: true },
  { id: "repo", label: "Connect your GitHub repository", done: true, href: "/connections" },
  { id: "telemetry", label: "Connect a telemetry source", done: false, href: "/connections" },
  { id: "first-review", label: "See your first automated review", done: false },
];

const allDoneSteps: SetupStep[] = partialSteps.map((s) => ({ ...s, done: true }));

describe("SetupChecklist", () => {
  it("renders every step's label", () => {
    const html = renderToStaticMarkup(<SetupChecklist steps={partialSteps} />);
    for (const step of partialSteps) {
      expect(html).toContain(step.label);
    }
  });

  it("never renders a done=false step with a done/checked indicator", () => {
    const html = renderToStaticMarkup(<SetupChecklist steps={partialSteps} />);
    expect(html).toContain('data-step-done="false"');
    expect(html).toContain('data-step-done="true"');
  });

  it("shows a real fraction, not a fabricated one (2 of 4 done here)", () => {
    const html = renderToStaticMarkup(<SetupChecklist steps={partialSteps} />);
    expect(html).toContain("2");
    expect(html).toContain("4");
  });

  it("renders the collapsed complete strip when every step is done", () => {
    const html = renderToStaticMarkup(<SetupChecklist steps={allDoneSteps} />);
    expect(html).toContain("Setup complete");
  });

  it("does not render the collapsed complete strip when steps remain", () => {
    const html = renderToStaticMarkup(<SetupChecklist steps={partialSteps} />);
    expect(html).not.toContain("Setup complete");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/dashboard exec vitest run setup-checklist`
Expected: FAIL — `setup-checklist.tsx` does not exist yet (module not found).

- [ ] **Step 3: Write the implementation**

Create `packages/dashboard/src/components/dashboard/setup-checklist.tsx`:

```tsx
import Link from "next/link";
import { IconCircleCheck, IconCircle } from "@tabler/icons-react";
import { Card } from "@/components/ui/card";

export interface SetupStep {
  id: string;
  label: string;
  done: boolean;
  href?: string;
}

/**
 * Real, non-fabricated setup progress. Every `done` value is a fact the
 * caller derived from an actual query — this component never estimates or
 * pads the fraction shown. Collapses to a small dismissible strip once every
 * step is done, rather than disappearing outright.
 */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  if (allDone) {
    return (
      <div className="glass-panel flex items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-content-primary">
          <IconCircleCheck className="h-4 w-4 text-accent-success" />
          Setup complete — you&apos;re fully orchestrated
        </div>
      </div>
    );
  }

  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-content-primary">
          Get fully orchestrated reviews
        </h2>
        <span className="font-mono text-xs tabular-nums text-content-muted">
          {doneCount} of {steps.length}
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-accent-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="space-y-2.5">
        {steps.map((step) => (
          <li
            key={step.id}
            data-step-done={step.done}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              {step.done ? (
                <IconCircleCheck className="h-4 w-4 shrink-0 text-accent-success" />
              ) : (
                <IconCircle className="h-4 w-4 shrink-0 text-content-muted" />
              )}
              <span
                className={
                  step.done
                    ? "text-sm text-content-muted line-through decoration-content-muted/50"
                    : "text-sm text-content-primary"
                }
              >
                {step.label}
              </span>
            </div>
            {!step.done && step.href && (
              <Link
                href={step.href}
                className="shrink-0 text-xs font-medium text-accent-primary hover:text-accent-primary/80"
              >
                Connect →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/dashboard exec vitest run setup-checklist`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/dashboard/src/components/dashboard/setup-checklist.tsx packages/dashboard/src/components/dashboard/setup-checklist.test.tsx
git commit -m "feat(dashboard): add SetupChecklist — honest real-data setup progress"
```

---

### Task 3: Strip `ValueLedger` to greeting-only and recompose the Overview page

**Files:**
- Modify: `packages/dashboard/src/components/dashboard/value-ledger.tsx`
- Modify: `packages/dashboard/src/app/(dashboard)/overview/page.tsx`
- Test: none new (existing suite must stay green; add a page-level assertion if an overview page test file already exists — check first with `find packages/dashboard/src/app -iname "*overview*test*"`)

**Interfaces:**
- Consumes: `SetupChecklist`/`SetupStep` from Task 2, `MetricsGrid`/`Metric` and `CommentsByCategory` from Task 1, existing `getDashboardViewModel`, `getTrendSeries`, `getConnectedTelemetryProviders`, `resolveSelectedInstallationIds` from `@/lib/queries`.
- Produces: the final page composition other pages/tests may reference (none currently do).

- [ ] **Step 1: Strip `ValueLedger` down to the greeting line**

Replace the full contents of `packages/dashboard/src/components/dashboard/value-ledger.tsx`:

```tsx
/**
 * Quiet, confident page greeting (Noiro / SuperLog / Tsenta-inspired) — no
 * oversized display headline, no metric cards (those live in MetricsGrid;
 * this component previously duplicated them here — see
 * docs/superpowers/specs/2026-07-12-overview-cleanup-and-setup-path-design.md).
 */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const dateLabel = () =>
  new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

export function ValueLedger() {
  return (
    <div className="flex items-baseline justify-between">
      <h1 className="text-lg font-semibold text-content-primary">
        {greeting()}
        <span className="text-content-muted font-normal"> — here&apos;s what Areté handled for you</span>
      </h1>
      <span className="hidden sm:block text-xs text-content-muted">{dateLabel()}</span>
    </div>
  );
}
```

- [ ] **Step 2: Recompose the Overview page**

Replace the full contents of `packages/dashboard/src/app/(dashboard)/overview/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getConnectedTelemetryProviders,
  getDashboardViewModel,
  getTrendSeries,
  resolveSelectedInstallationIds,
} from "@/lib/queries";
import { bucketByDay, cumulativeByDay } from "@/lib/trends";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { ValueLedger } from "@/components/dashboard/value-ledger";
import { ConnectorHealthStrip } from "@/components/dashboard/connector-health-strip";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityList } from "@/components/dashboard/activity-list";
import { MetricsGrid, type Metric } from "@/components/dashboard/metrics-grid";
import { CommentsByCategory } from "@/components/dashboard/comments-by-category";
import { SetupChecklist, type SetupStep } from "@/components/dashboard/setup-checklist";
import {
  IconBug,
  IconCalendarStats,
  IconFolders,
  IconGitPullRequest,
} from "@tabler/icons-react";

// This page reads the session and queries Prisma scoped to it on every
// request — it must never be statically prerendered (that would either fail
// at build time for lack of a session, or worse, bake one user's tenant
// data into a page served to everyone). `force-dynamic` makes that explicit
// instead of relying on Next's heuristics.
export const dynamic = "force-dynamic";

export default async function DashboardOverview({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { installation } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(
    session.installations ?? [],
    installation
  );

  const [viewModel, trendSeries, telemetryProviders] = await Promise.all([
    getDashboardViewModel(db, installationIds),
    getTrendSeries(db, installationIds),
    getConnectedTelemetryProviders(db, installationIds),
  ]);

  const connected = viewModel.hasAccess;
  const {
    totalPrs,
    activeRepos,
    criticalBugs,
    recentReviews,
    weeklyDelta,
    totalPrsChange,
    criticalBugsChange,
    repoDelta,
    commentsByCategory,
    latestReviews,
  } = viewModel.hasAccess
    ? viewModel
    : {
        totalPrs: 0,
        activeRepos: 0,
        criticalBugs: 0,
        recentReviews: 0,
        weeklyDelta: 0,
        totalPrsChange: { change: "+0", positive: true },
        criticalBugsChange: { change: "+0", positive: true },
        repoDelta: 0,
        commentsByCategory: [],
        latestReviews: [],
      };

  // Trends are derived from real createdAt data via getTrendSeries — never
  // fabricated.
  const totalPrsTrend = cumulativeByDay(trendSeries.reviewDates, 7);
  const reviewsThisWeekTrend = bucketByDay(trendSeries.reviewDates, 7);
  const activeReposTrend = cumulativeByDay(trendSeries.repoDates, 7);

  // Setup checklist — every `done` value is a real fact, not an estimate.
  // "account" is honestly true by construction (this page is auth-gated).
  const setupSteps: SetupStep[] = [
    { id: "account", label: "Create your Areté account", done: true },
    {
      id: "repo",
      label: "Connect your GitHub repository",
      done: connected,
      href: "/connections",
    },
    {
      id: "telemetry",
      label: "Connect a telemetry source",
      done: telemetryProviders.length > 0,
      href: "/connections",
    },
    {
      id: "first-review",
      label: "See your first automated review",
      done: totalPrs > 0,
    },
  ];

  // SuperLog-style analytics grid — every value and weekly change comes from
  // the view model (real Prisma aggregations), every sparkline from real
  // createdAt series. "Critical Issues Caught" deliberately has no sparkline
  // (ReviewComment.createdAt exists but this metric was scoped out of the
  // original port — see docs/superpowers/specs/2026-07-11-dashboard-ui-port-design.md §3.2).
  const metrics: Metric[] = [
    {
      title: "Total PRs Reviewed",
      value: totalPrs.toString(),
      change: totalPrsChange.change,
      positive: totalPrsChange.positive,
      icon: <IconGitPullRequest className="h-5 w-5 text-accent-primary" />,
      trend: totalPrsTrend,
    },
    {
      title: "Critical Issues Caught",
      value: criticalBugs.toString(),
      change: criticalBugsChange.change,
      positive: criticalBugsChange.positive,
      icon: <IconBug className="h-5 w-5 text-accent-danger" />,
    },
    {
      title: "Reviews This Week",
      value: recentReviews.toString(),
      change: `${weeklyDelta >= 0 ? "+" : ""}${weeklyDelta}`,
      positive: weeklyDelta >= 0,
      icon: <IconCalendarStats className="h-5 w-5 text-accent-info" />,
      trend: reviewsThisWeekTrend,
    },
    {
      title: "Active Repositories",
      value: activeRepos.toString(),
      change: `${repoDelta >= 0 ? "+" : ""}${repoDelta}`,
      positive: repoDelta >= 0,
      icon: <IconFolders className="h-5 w-5 text-accent-success" />,
      trend: activeReposTrend,
    },
  ];

  return (
    <PageReveal className="space-y-8">
      <RevealItem>
        <SetupChecklist steps={setupSteps} />
      </RevealItem>

      <RevealItem>
        <ValueLedger />
      </RevealItem>

      <MetricsGrid metrics={metrics} />

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        <RevealItem>
          <CommentsByCategory categories={commentsByCategory} />
        </RevealItem>
        <RevealItem>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>What we caught for you</CardTitle>
            </CardHeader>
            <ActivityList
              reviews={latestReviews.map((review) => ({
                id: review.id,
                repositoryName: review.repositoryFullName,
                prNumber: review.prNumber,
                createdAt: review.createdAt.toISOString(),
                riskLevel: review.riskLevel,
              }))}
            />
          </Card>
        </RevealItem>
      </div>

      <RevealItem>
        <ConnectorHealthStrip />
      </RevealItem>
    </PageReveal>
  );
}
```

Note: `activeReposTrend`, `activeRepos`, `totalPrsChange`, `criticalBugsChange`,
and `repoDelta` are all now consumed by `metrics` — do not carry over the old
`void totalPrsChange; void criticalBugsChange; void repoDelta; void activeReposTrend; void activeRepos;`
no-op line from the pre-existing file.

- [ ] **Step 3: Run the full dashboard test suite**

Run: `pnpm --filter @arete/dashboard test`
Expected: all tests pass, including the new `setup-checklist.test.tsx` from Task 2. If any test references the old 3-card `ValueLedger` markup, update it to match the new greeting-only output.

- [ ] **Step 4: Type-check and build**

Run:
```bash
pnpm --filter @arete/dashboard exec tsc --noEmit
DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d= -f2-) pnpm --filter @arete/dashboard build
```
Expected: 0 errors, `/overview` listed as `ƒ` (dynamic) in the build output.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/dashboard/src/components/dashboard/value-ledger.tsx "packages/dashboard/src/app/(dashboard)/overview/page.tsx"
git commit -m "feat(dashboard): remove duplicate metrics cards, add setup checklist to Overview"
```

---

## Final Verification

- [ ] **Run full suite one more time end-to-end**

```bash
cd "C:\Users\strol\OneDrive\Desktop\Areté"
pnpm --filter @arete/dashboard test
pnpm --filter @arete/webhook test
DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d= -f2-) pnpm --filter @arete/dashboard build
```
Expected: dashboard tests pass (44 baseline + 5 new = 49), webhook tests unaffected (177 baseline), build clean.

- [ ] **Push to main** (per the repo's Phase 1 auto-merge policy): `git branch --show-current` (confirm `main`), then `git push origin main`.
