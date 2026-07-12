# Dashboard UI Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the finished dashboard design system (tokens, primitives, motion, the agent-orchestration graph) from the abandoned `feat/dashboard-ui-redesign` branch onto `main`'s current, restructured dashboard (`app/(dashboard)/*`, `@arete/db`, real auth via `getDashboardViewModel`), per `docs/superpowers/specs/2026-07-11-dashboard-ui-port-design.md`.

**Architecture:** Most design-system files (tokens, `ui/*` primitives, most `dashboard/*` presentational components, `lib/motion.ts`, `lib/utils.ts`) are copied verbatim — they never depended on the old data shape. `Sidebar` and `DashboardShell` get a small, real modification to accept and thread through real session data (`installations`, `userName`) instead of hardcoded placeholders. `app/(dashboard)/page.tsx` and `app/(dashboard)/layout.tsx` are full rewrites that keep `main`'s auth gate and `getDashboardViewModel` call intact while rendering through the ported design system. One new, narrow, additive query function (`getTrendSeries`) supplies the sparkline data `getDashboardViewModel` doesn't provide.

**Tech Stack:** Next.js 16 App Router, Tailwind v4, Framer Motion, Radix UI, `@arete/db` (Prisma), NextAuth.js v5 (Auth.js beta), Vitest.

## Global Constraints

- Branch: `feat/dashboard-ui-port`, worktree `.worktrees/dashboard-ui-port`, branched from local `main` (already created, ledger already declared, spec already committed).
- Scope strictly `packages/dashboard`, except the one new function in `src/lib/queries.ts` (additive only — do not modify `getDashboardViewModel` itself or its existing tests).
- Do NOT touch `packages/db`, `packages/agents`, `packages/webhook`, `infra/`, or any Prisma schema/migration.
- Do NOT change `lib/auth.ts`, `lib/installations.ts`, `lib/installation-cache.ts`, `lib/github.ts`, or `proxy.ts` — these are the hardened, tested security surface. Only their *consumers* (page/layout) and the components that display their data get touched.
- `getDashboardViewModel`'s existing behavior, shape, and tests (`queries.test.ts`'s existing cases) must not change or regress.
- **Verbatim-copy tasks below give an exact source file path** (in the old, still-present `feat/dashboard-ui-redesign` worktree) and exact destination path. Copy the file's content exactly as it exists at that source path — this is a complete, unambiguous instruction, not a placeholder; the source is a real, already-reviewed file in version control.
- Build baseline: `pnpm --filter @arete/dashboard build` → 0 errors. Lint: `pnpm --filter @arete/dashboard lint` → 0 new errors. **Test: `pnpm --filter @arete/dashboard test` (vitest) → the existing suite must stay green, plus new tests added by this plan.** This is a real, enforced gate — unlike the two prior redesign rounds, this package now has a real test suite.
- No WebGL/Three.js. No fabricated data or fake affordances (the honesty principle carries over unchanged from the original design).
- Model routing (per user preference: `fable` over `opus` for the strong tier): mechanical verbatim-copy tasks → `sonnet`; the new query function + its test → `sonnet` (mechanical, follows an established pattern exactly); the page/layout rewrites and Sidebar modification (real integration judgment) → `fable`; the reskin task → `sonnet`; final verification → `sonnet`.

---

### Task 16: Port static design-system files verbatim

**Files:**
- Modify: `packages/dashboard/src/app/globals.css` (append tokens — main's file already has `:root`/`body`/`.glass` unmodified; only the additions below are new)
- Create: `packages/dashboard/src/lib/motion.ts` — copy verbatim from `C:\Users\strol\orca\workspaces\Areté\Test-02\.worktrees\dashboard-ui-redesign\packages\dashboard\src\lib\motion.ts`
- Create: `packages/dashboard/src/lib/utils.ts` — copy verbatim from `C:\Users\strol\orca\workspaces\Areté\Test-02\.worktrees\dashboard-ui-redesign\packages\dashboard\src\lib\utils.ts`
- Create: `packages/dashboard/src/components/ui/badge.tsx`, `button.tsx`, `card.tsx`, `skeleton.tsx`, `tooltip.tsx` — copy verbatim from the matching paths under `C:\Users\strol\orca\workspaces\Areté\Test-02\.worktrees\dashboard-ui-redesign\packages\dashboard\src\components\ui\`
- Create: `packages/dashboard/src/components/dashboard/activity-list.tsx`, `agent-orchestration-graph.tsx`, `category-breakdown.tsx`, `count-up-value.tsx`, `empty-state.tsx`, `metrics-grid.tsx`, `page-reveal.tsx`, `sparkline.tsx`, `topbar.tsx` — copy verbatim from the matching paths under `C:\Users\strol\orca\workspaces\Areté\Test-02\.worktrees\dashboard-ui-redesign\packages\dashboard\src\components\dashboard\`

**Do NOT copy** `sidebar.tsx` or `dashboard-shell.tsx` from that source — those need real modifications and are handled in Task 18.

**Interfaces:**
- Produces: `cn()`, motion tokens (`motionDuration`, `springTransition`, `staggerContainer`, `fadeSlideUp`), all `ui/*` primitives, and all copied `dashboard/*` presentational components with their existing prop types unchanged — consumed by Tasks 18-20.
- Produces: Tailwind utilities `surface-0/1/2`, `border-subtle/default/strong`, `accent-primary/secondary/info/success/danger`, `content-primary/secondary/muted`, `font-mono`, `ease-out-expo`/`ease-out-quart` — consumed by every component task.

- [ ] **Step 1: Append the design-token layer to `globals.css`**

Read the current `packages/dashboard/src/app/globals.css` fresh (it currently has only `@import "tailwindcss";`, `:root`, `body`, `.glass`, `.glass-panel`, `.glass-panel:hover`). Insert the following `@theme inline` block immediately after the `@import "tailwindcss";` line (before `:root`):
```css
@theme inline {
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace;
  --color-surface-0: #020617;
  --color-surface-1: rgba(255, 255, 255, 0.03);
  --color-surface-2: rgba(255, 255, 255, 0.08);
  --color-border-subtle: rgba(255, 255, 255, 0.05);
  --color-border-default: rgba(255, 255, 255, 0.08);
  --color-border-strong: rgba(255, 255, 255, 0.15);
  --color-accent-primary: #818cf8;
  --color-accent-secondary: #c084fc;
  --color-accent-info: #22d3ee;
  --color-accent-success: #34d399;
  --color-accent-danger: #fb7185;
  --color-content-primary: #f1f5f9;
  --color-content-secondary: #cbd5e1;
  --color-content-muted: #94a3b8;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
}
```
Then replace the existing `.glass-panel` block's `transition` line only (rest identical) so it reads:
```css
.glass-panel {
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
  transition: all 0.3s var(--ease-out-quart);
  border-radius: 1rem;
}
```
Replace the existing `.glass-panel:hover` block (remove the lift/shadow — that's opt-in now) so it reads:
```css
/* Static panels acknowledge the cursor faintly, but do NOT lift or shadow-pop —
   that affordance is reserved for genuinely interactive cards (see .glass-panel-interactive
   below). A panel that isn't clickable shouldn't move like a button. */
.glass-panel:hover {
  background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
```
Append, at the end of the file:
```css
/* Opt-in hover-lift for cards that represent a real, actionable target (e.g. a real link).
   Apply via the `interactive` prop on <Card>.
   The transition lives on the base selector (not :hover) so hover-enter and
   hover-exit share the same timing/easing. */
.glass-panel-interactive {
  transition: all 0.3s var(--ease-out-expo);
}

.glass-panel-interactive:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px 0 rgba(0, 0, 0, 0.4);
}

.glass-panel-active {
  background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%);
  border: 1px solid rgba(129, 140, 248, 0.3);
  box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.15), 0 8px 32px 0 rgba(0, 0, 0, 0.3);
  border-radius: 1rem;
}
```
Do NOT touch `:root`, `body`, or `.glass` — unchanged from `main`'s current file.

- [ ] **Step 2: Copy the verbatim files listed above**

For each file listed in this task's **Files** section (2 `lib/*`, 5 `ui/*`, 9 `dashboard/*` — 16 files total), read the source file at its exact path in the `feat/dashboard-ui-redesign` worktree and write an identical copy at the destination path in this worktree. Do not alter imports, logic, or formatting.

- [ ] **Step 3: Add JetBrains Mono font + content-primary text color to the root layout**

Modify `packages/dashboard/src/app/layout.tsx` (the current, thin, chrome-free root layout — do NOT copy the old branch's version, which incorrectly wraps `DashboardShell` at the root; `main`'s separation of a chrome-free root from the authenticated `(dashboard)` route group is correct and must be preserved):
```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Areté AI Code Review",
  description: "Premium AI Code Review Platform",
};

// Root layout stays chrome-free (just the html/body shell) so /login can
// render without the authenticated sidebar. The dashboard sidebar chrome —
// which needs the session — lives in app/(dashboard)/layout.tsx and is only
// mounted for routes inside that group.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} font-sans h-full antialiased dark`}>
      <body className="min-h-full flex text-content-primary selection:bg-indigo-500/30">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @arete/dashboard build`
Expected: 0 errors. Nothing consumes the new components yet, so no visual change to any existing route is expected.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app/globals.css packages/dashboard/src/app/layout.tsx packages/dashboard/src/lib/motion.ts packages/dashboard/src/lib/utils.ts packages/dashboard/src/components/ui packages/dashboard/src/components/dashboard/activity-list.tsx packages/dashboard/src/components/dashboard/agent-orchestration-graph.tsx packages/dashboard/src/components/dashboard/category-breakdown.tsx packages/dashboard/src/components/dashboard/count-up-value.tsx packages/dashboard/src/components/dashboard/empty-state.tsx packages/dashboard/src/components/dashboard/metrics-grid.tsx packages/dashboard/src/components/dashboard/page-reveal.tsx packages/dashboard/src/components/dashboard/sparkline.tsx packages/dashboard/src/components/dashboard/topbar.tsx
git commit -m "feat(dashboard): port design-system tokens, primitives, and presentational components"
```

---

### Task 17: `getTrendSeries` — new additive query function + test

**Files:**
- Modify: `packages/dashboard/src/lib/queries.ts` (add a new export, do not touch `getDashboardViewModel` or any existing export)
- Modify: `packages/dashboard/src/lib/queries.test.ts` (add a new test block, do not touch existing tests)
- Create: `packages/dashboard/src/lib/trends.ts`

**Interfaces:**
- Consumes: `PrismaClient` type from `@arete/db` (already imported in `queries.ts`).
- Produces: `TrendSeries` interface `{ reviewDates: Date[]; repoDates: Date[] }` and `getTrendSeries(db: PrismaClient, installationIds: string[]): Promise<TrendSeries>` — consumed by Task 20.
- Produces: `bucketByDay(dates: Date[], days: number): number[]` and `cumulativeByDay(dates: Date[], days: number): number[]` from `@/lib/trends` — consumed by Task 20.

- [ ] **Step 1: Create `trends.ts`**

Create `packages/dashboard/src/lib/trends.ts`:
```ts
export function bucketByDay(dates: Date[], days: number): number[] {
  const buckets = Array(days).fill(0);
  const dayMs = 24 * 60 * 60 * 1000;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const date of dates) {
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / dayMs);
    const index = days - 1 - diffDays;
    if (index >= 0 && index < days) buckets[index] += 1;
  }

  return buckets;
}

export function cumulativeByDay(dates: Date[], days: number): number[] {
  const perDay = bucketByDay(dates, days);
  const countedInWindow = perDay.reduce((a, b) => a + b, 0);
  let running = dates.length - countedInWindow;
  return perDay.map((count) => (running += count));
}
```

- [ ] **Step 2: Add `getTrendSeries` to `queries.ts`**

Modify `packages/dashboard/src/lib/queries.ts`. Add this export at the end of the file (after `getDashboardViewModel` — do not modify anything above it):
```ts
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
```

- [ ] **Step 3: Add a test in `queries.test.ts`**

Read the current `packages/dashboard/src/lib/queries.test.ts` fresh to see the exact shape of its `createFakeDb` helper (it builds an in-memory fake Prisma from `FakeRepo`/`FakeReview`/`FakeComment` arrays). Confirm whether `repository.findMany` and a bare `review.findMany({ where, select: { createdAt: true } })` (no `take`/`orderBy`/`include`) are already supported by the fake; if not, extend the SAME `createFakeDb` factory to support them, following the exact same scoping-filter pattern already used by its existing `repository.count`/`review.count` fakes — do not create a second, parallel fake-db helper.

Add this test block, importing `getTrendSeries` alongside the existing imports from `./queries`:
```ts
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
```
Adjust exact `FakeRepo`/`FakeReview` field names/types to match whatever the live file's existing fakes actually use — read the file first, don't assume this sketch is byte-exact.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @arete/dashboard test`
Expected: all existing tests still pass, plus the 2 new `getTrendSeries` tests pass.

Run: `pnpm --filter @arete/dashboard build`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/trends.ts packages/dashboard/src/lib/queries.ts packages/dashboard/src/lib/queries.test.ts
git commit -m "feat(dashboard): add getTrendSeries query function for sparkline data"
```

---

### Task 18: Modify Sidebar + DashboardShell to carry real session data

**Files:**
- Modify (adapted from the old branch — NOT a verbatim copy): `packages/dashboard/src/components/dashboard/sidebar.tsx`
- Modify (adapted from the old branch — NOT a verbatim copy): `packages/dashboard/src/components/dashboard/dashboard-shell.tsx`

**Interfaces:**
- Consumes: `AuthorizedInstallation` type from `@/lib/installations` (existing, untouched); `InstallationSwitcher`, `SignOutButton` from `@/components/InstallationSwitcher`, `@/components/SignOutButton` (existing — reskinned in Task 21, but their exported names/props don't change there).
- Produces: `Sidebar({ collapsed, onToggleCollapsed, installations, userName }: SidebarProps)` and `DashboardShell({ children, installations, userName }: DashboardShellProps)` — consumed by Task 19.

- [ ] **Step 1: Create the modified `sidebar.tsx`**

Create `packages/dashboard/src/components/dashboard/sidebar.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { springTransition } from "@/lib/motion";
import { InstallationSwitcher } from "@/components/InstallationSwitcher";
import { SignOutButton } from "@/components/SignOutButton";
import type { AuthorizedInstallation } from "@/lib/installations";

const collapseTransition = { ...springTransition, opacity: { duration: 0.15 } } as const;

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/history", label: "Review History" },
  { href: "/settings", label: "Settings" },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  installations: AuthorizedInstallation[];
  userName: string;
}

export function Sidebar({ collapsed, onToggleCollapsed, installations, userName }: SidebarProps) {
  const pathname = usePathname();
  const initial = userName.charAt(0).toUpperCase();

  return (
    <aside
      className={cn(
        "glass border-r border-slate-800/50 flex flex-col fixed h-full z-20 transition-all duration-300",
        collapsed ? "w-20" : "w-64"
      )}
    >
      <div className="p-6 h-[68px] flex items-center overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {collapsed ? (
            <motion.h1
              key="brand-mark"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={collapseTransition}
              className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300 tracking-tight"
            >
              A
            </motion.h1>
          ) : (
            <motion.h1
              key="brand-wordmark"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={collapseTransition}
              className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300 tracking-tight whitespace-nowrap"
            >
              Areté AI
            </motion.h1>
          )}
        </AnimatePresence>
      </div>

      {!collapsed && installations.length > 1 && (
        <div className="px-4 mb-2">
          <InstallationSwitcher installations={installations} />
        </div>
      )}

      <nav className="flex-1 px-4 space-y-1.5 mt-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-colors duration-150",
                isActive ? "text-content-primary" : "text-content-muted hover:text-white hover:bg-white/5"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-indicator"
                  className="absolute inset-0 bg-white/5 border border-border-default rounded-xl shadow-sm"
                  transition={springTransition}
                />
              )}
              <span className="relative grid">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={collapsed ? "short" : "full"}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={collapseTransition}
                    className="col-start-1 row-start-1 whitespace-nowrap"
                  >
                    {collapsed ? item.label[0] : item.label}
                  </motion.span>
                </AnimatePresence>
              </span>
            </Link>
          );
        })}
      </nav>

      <button
        onClick={onToggleCollapsed}
        className="mx-4 mb-2 flex items-center justify-center h-8 rounded-lg text-content-muted hover:text-white hover:bg-white/5 transition-colors"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <IconChevronRight className="w-4 h-4" /> : <IconChevronLeft className="w-4 h-4" />}
      </button>

      <div className="p-4 border-t border-slate-800/50">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-sm font-bold shadow-lg ring-2 ring-indigo-500/20 shrink-0">
            {initial}
          </div>
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                key="user-info"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={collapseTransition}
                className="text-sm overflow-hidden whitespace-nowrap min-w-0 flex-1"
              >
                <p className="font-medium text-content-secondary truncate">{userName}</p>
                <SignOutButton />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </aside>
  );
}
```
Note: `main`'s current `InstallationSwitcher` already renders `null` when `installations.length <= 1`, so the outer `installations.length > 1` check here is redundant with that internal guard but is kept to avoid rendering the wrapping `<div className="px-4 mb-2">` (with its margin) for a component that will render nothing — matching `main`'s current layout behavior exactly.

- [ ] **Step 2: Create the modified `dashboard-shell.tsx`**

Create `packages/dashboard/src/components/dashboard/dashboard-shell.tsx`:
```tsx
"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { cn } from "@/lib/utils";
import type { AuthorizedInstallation } from "@/lib/installations";

interface DashboardShellProps {
  children: ReactNode;
  installations: AuthorizedInstallation[];
  userName: string;
}

export function DashboardShell({ children, installations, userName }: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        installations={installations}
        userName={userName}
      />
      <main
        className={cn(
          "flex-1 min-h-screen relative overflow-hidden transition-all duration-300",
          collapsed ? "ml-20" : "ml-64"
        )}
      >
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
        <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
        <Topbar />
        <div className="p-8">{children}</div>
      </main>
    </>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @arete/dashboard build`
Expected: 0 errors. `DashboardShell` has no consumer yet (Task 19) — this only confirms the two files typecheck against `InstallationSwitcher`/`SignOutButton`/`AuthorizedInstallation`'s actual current exports.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/components/dashboard/sidebar.tsx packages/dashboard/src/components/dashboard/dashboard-shell.tsx
git commit -m "feat(dashboard): thread real session data (installations, userName) through Sidebar and DashboardShell"
```

---

### Task 19: Rewrite `app/(dashboard)/layout.tsx` — MODEL: fable

**Files:**
- Modify: `packages/dashboard/src/app/(dashboard)/layout.tsx` (full rewrite)

**Interfaces:**
- Consumes: `auth` from `../../lib/auth` (unchanged); `DashboardShell` from `@/components/dashboard/dashboard-shell` (Task 18); `SignOutButton` from `@/components/SignOutButton` (existing, unchanged).

**Amendment (discovered during Task 18):** `DashboardShell`/`Sidebar` are Client Components and can never `import` `SignOutButton` directly — it's a Server Component that pulls in `lib/auth` → `lib/db` → `pg` (Node-only), and importing a Server Component module into a Client Component's file breaks the client bundle graph regardless of runtime behavior. Task 18 was corrected to accept a `signOutSlot: ReactNode` prop instead of importing `SignOutButton` itself. This layout — a real Server Component — is the correct place to import `SignOutButton` and pass its rendered output down as that slot.

- [ ] **Step 1: Rewrite the file**

Replace the entire content of `packages/dashboard/src/app/(dashboard)/layout.tsx` with:
```tsx
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SignOutButton } from "@/components/SignOutButton";

// This layout wraps every authenticated dashboard route. It reads the
// session itself (in addition to proxy.ts) so it can render the signed-in
// user and their authorized installations — proxy.ts only gates access, it
// doesn't hand session data to the render tree.
//
// SignOutButton is a Server Component (it imports lib/auth's server-only
// signOut action) and is passed down to DashboardShell/Sidebar — both
// Client Components — as an already-rendered ReactNode slot, not imported
// by them directly. A Client Component can never import a Server Component
// module itself; it can only render one it's handed as children/props.
export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const installations = session.installations ?? [];
  const userName = session.user.name ?? session.user.email ?? "Signed in";

  return (
    <DashboardShell
      installations={installations}
      userName={userName}
      signOutSlot={<SignOutButton />}
    >
      {children}
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @arete/dashboard build`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "packages/dashboard/src/app/(dashboard)/layout.tsx"
git commit -m "feat(dashboard): rewrite (dashboard) layout onto DashboardShell with real session data"
```

---

### Task 20: Rewrite `app/(dashboard)/page.tsx` — MODEL: fable

**Files:**
- Modify: `packages/dashboard/src/app/(dashboard)/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `auth`, `getDashboardViewModel`, `resolveSelectedInstallationIds`, `db` (all unchanged, existing); `getTrendSeries` (Task 17); `bucketByDay`/`cumulativeByDay` from `@/lib/trends` (Task 17); `EmptyState` from `../../components/EmptyState` (unchanged, existing — the `hasAccess: false` one); `PageReveal`/`RevealItem`, `MetricsGrid`/`type Metric`, `Card`/`CardHeader`/`CardTitle`, `ActivityList`, `AgentOrchestrationGraph`, `CategoryBreakdown` (all Task 16).

- [ ] **Step 1: Rewrite the file**

Replace the entire content of `packages/dashboard/src/app/(dashboard)/page.tsx` with:
```tsx
import { IconChartBar, IconBug, IconCalendarStats, IconActivity } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { db } from "../../lib/db";
import { getDashboardViewModel, getTrendSeries, resolveSelectedInstallationIds } from "../../lib/queries";
import { bucketByDay, cumulativeByDay } from "../../lib/trends";
import { EmptyState } from "../../components/EmptyState";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { MetricsGrid, type Metric } from "@/components/dashboard/metrics-grid";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityList } from "@/components/dashboard/activity-list";
import { AgentOrchestrationGraph } from "@/components/dashboard/agent-orchestration-graph";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";

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

  const [viewModel, trendSeries] = await Promise.all([
    getDashboardViewModel(db, installationIds),
    getTrendSeries(db, installationIds),
  ]);

  if (!viewModel.hasAccess) {
    return <EmptyState />;
  }

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
  } = viewModel;

  // Trends are derived from real createdAt data via getTrendSeries — never
  // fabricated. "Critical Bugs Prevented" deliberately has no sparkline:
  // scoped out of this port (see docs/superpowers/specs/2026-07-11-dashboard-ui-port-design.md
  // §3.2) even though ReviewComment now has a createdAt column on main.
  const totalPrsTrend = cumulativeByDay(trendSeries.reviewDates, 7);
  const reviewsThisWeekTrend = bucketByDay(trendSeries.reviewDates, 7);
  const activeReposTrend = cumulativeByDay(trendSeries.repoDates, 7);

  const metrics: Metric[] = [
    {
      title: "Total PRs Reviewed",
      value: totalPrs.toString(),
      change: totalPrsChange.change,
      positive: totalPrsChange.positive,
      icon: <IconChartBar className="w-6 h-6 text-accent-primary" />,
      trend: totalPrsTrend,
    },
    {
      title: "Critical Bugs Prevented",
      value: criticalBugs.toString(),
      change: criticalBugsChange.change,
      positive: criticalBugsChange.positive,
      icon: <IconBug className="w-6 h-6 text-accent-success" />,
    },
    {
      title: "Reviews This Week",
      value: recentReviews.toString(),
      change: `${weeklyDelta >= 0 ? "+" : ""}${weeklyDelta} vs last week`,
      positive: weeklyDelta >= 0,
      icon: <IconCalendarStats className="w-6 h-6 text-accent-info" />,
      trend: reviewsThisWeekTrend,
    },
    {
      title: "Active Repositories",
      value: activeRepos.toString(),
      change: `${repoDelta >= 0 ? "+" : ""}${repoDelta}`,
      positive: repoDelta >= 0,
      icon: <IconActivity className="w-6 h-6 text-accent-secondary" />,
      trend: activeReposTrend,
    },
  ];

  return (
    <PageReveal className="space-y-8">
      <RevealItem>
        <h1 className="text-2xl font-semibold text-content-primary">Overview</h1>
      </RevealItem>

      <MetricsGrid metrics={metrics} />

      <RevealItem className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Agent Orchestration</CardTitle>
            <button
              disabled
              title="Review history coming soon"
              className="text-sm text-content-muted font-medium opacity-60 cursor-not-allowed"
            >
              View All
            </button>
          </CardHeader>
          <AgentOrchestrationGraph activeRepos={activeRepos} totalPrs={totalPrs} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest Activity</CardTitle>
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

      <RevealItem>
        <Card>
          <CardHeader>
            <CardTitle>Comments by Category</CardTitle>
          </CardHeader>
          <CategoryBreakdown categories={commentsByCategory} />
        </Card>
      </RevealItem>
    </PageReveal>
  );
}
```
Note: `viewModel.latestReviews[].repositoryFullName` is already flattened (unlike the old branch's nested `review.repository.fullName`) — the `ActivityList` mapping above uses `review.repositoryFullName` directly. `viewModel.commentsByCategory` is already shaped as `{ category, count }[]` — passed straight to `CategoryBreakdown` with no `.map()` needed.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @arete/dashboard build`
Expected: 0 errors.

Run: `pnpm --filter @arete/dashboard lint`
Expected: 0 new errors (compare against the baseline documented in Task 22).

- [ ] **Step 3: Commit**

```bash
git add "packages/dashboard/src/app/(dashboard)/page.tsx"
git commit -m "feat(dashboard): rewrite (dashboard) page onto getDashboardViewModel + getTrendSeries with ported design system"
```

---

### Task 21: Light-touch reskin of auth UI

**Files:**
- Modify: `packages/dashboard/src/components/InstallationSwitcher.tsx`
- Modify: `packages/dashboard/src/components/SignOutButton.tsx`
- Modify: `packages/dashboard/src/app/login/page.tsx`
- Modify: `packages/dashboard/src/components/EmptyState.tsx` (the top-level, `hasAccess: false` one — NOT `components/dashboard/empty-state.tsx`)

This is a class-name-only pass. Do not change any component's props, structure, behavior, or server-action logic. Do not touch `EmptyState.test.tsx` — verify it still passes untouched (Step 5); if a class-string assertion breaks, make a more conservative color swap rather than editing the test.

- [ ] **Step 1: Reskin `InstallationSwitcher.tsx`**

Modify `packages/dashboard/src/components/InstallationSwitcher.tsx` — change only the `<select>`'s `className`:
```tsx
      className="w-full bg-white/5 border border-border-default rounded-xl px-3 py-2 text-sm text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
```
(Previously: `bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40`.)

- [ ] **Step 2: Reskin `SignOutButton.tsx`**

Modify `packages/dashboard/src/components/SignOutButton.tsx` — change only the `<button>`'s `className`:
```tsx
        className="text-xs text-content-muted hover:text-content-secondary transition-colors"
```
(Previously: `text-xs text-slate-500 hover:text-slate-300 transition-colors`.)

- [ ] **Step 3: Reskin `login/page.tsx`**

Modify `packages/dashboard/src/app/login/page.tsx`:
```tsx
import { IconBrandGithub } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { auth, signIn } from "../../lib/auth";

export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
      <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />

      <div className="glass-panel max-w-sm w-full p-8 flex flex-col items-center gap-6 text-center">
        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300 tracking-tight">
          Areté AI
        </h1>
        <p className="text-sm text-content-muted">
          Sign in with the same GitHub account or org that installed the Areté GitHub App.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
          className="w-full"
        >
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium text-white bg-accent-primary/20 border border-accent-primary/30 hover:bg-accent-primary/30 transition-colors"
          >
            <IconBrandGithub className="w-5 h-5" />
            Sign in with GitHub
          </button>
        </form>
      </div>
    </div>
  );
}
```
Note: the outer `bg-white/5 border border-white/10 rounded-2xl` classes that were on the `glass-panel` div are removed since `.glass-panel` (Task 16) already provides that exact treatment via CSS.

- [ ] **Step 4: Reskin `components/EmptyState.tsx`** (top-level, `hasAccess: false` case)

Modify `packages/dashboard/src/components/EmptyState.tsx`:
```tsx
import { IconBrandGithub } from "@tabler/icons-react";

/**
 * Shown when the logged-in user is authenticated but authorized for zero
 * Installations — either they haven't installed the Areté GitHub App yet,
 * or they aren't an admin of any org/account that has. Never falls back to
 * rendering empty/zeroed metrics for this case, which would be
 * indistinguishable from "everything is fine, zero reviews so far".
 */
export function EmptyState() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center animate-in fade-in duration-500">
      <div className="glass-panel max-w-md w-full p-8 flex flex-col items-center gap-6 text-center">
        <div className="p-4 bg-accent-primary/10 rounded-2xl border border-accent-primary/20">
          <IconBrandGithub className="w-8 h-8 text-accent-primary" />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">
            Install the Areté GitHub App
          </h2>
          <p className="text-sm text-content-muted">
            We couldn&apos;t find any installation you administer. Install the Areté GitHub App on
            your account or org, or ask an org admin to, then come back and refresh.
          </p>
        </div>
        <a
          href="https://github.com/apps/arete-ai-code-review"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-accent-primary/20 border border-accent-primary/30 hover:bg-accent-primary/30 transition-colors"
        >
          <IconBrandGithub className="w-4 h-4" />
          Install on GitHub
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @arete/dashboard test`
Expected: `EmptyState.test.tsx` and all other existing tests still pass unchanged.

Run: `pnpm --filter @arete/dashboard build`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/components/InstallationSwitcher.tsx packages/dashboard/src/components/SignOutButton.tsx packages/dashboard/src/app/login/page.tsx packages/dashboard/src/components/EmptyState.tsx
git commit -m "style(dashboard): reskin auth UI (InstallationSwitcher, SignOutButton, login page, no-access EmptyState) onto design tokens"
```

---

### Task 22: Final integration, verification, and ledger update

**Files:**
- Modify: `.claude/ade-coordination.md` (status update only)

- [ ] **Step 1: Full build + lint + test pass**

Run, in order:
```bash
pnpm --filter @arete/dashboard build
pnpm --filter @arete/dashboard lint
pnpm --filter @arete/dashboard test
```
Expected: build 0 errors; lint 0 new errors (if `main` was already clean before this port, it must be clean after); test — all existing suites plus the new `getTrendSeries` tests pass.

- [ ] **Step 2: Manual authenticated verification**

Since `app/(dashboard)/page.tsx` is `force-dynamic` and gated by `auth()`, hitting `/` unauthenticated only proves the redirect-to-`/login` path works. Set up a real authenticated check:
1. Confirm `GITHUB_OAUTH_CLIENT_ID`/`GITHUB_OAUTH_CLIENT_SECRET` (or whatever `.env.example` documents) are configured for local dev.
2. Run `pnpm --filter @arete/dashboard dev`, open `http://localhost:3000`, and sign in with a real GitHub account through the OAuth flow (requires a seeded `Installation` row in the scratch/dev DB matching the signed-in account's login as `Installation.owner`).
3. Confirm: `/login` renders with the reskinned styling; after sign-in, the dashboard renders with the full ported design system (sidebar with real user name/initial and sign-out, metrics grid with sparklines and count-up, the agent-orchestration graph, category breakdown, staggered entrance); `InstallationSwitcher` appears only if authorized for 2+ installations; the no-access `EmptyState` renders (reskinned) if authorized for zero.
4. If a real OAuth round-trip is impractical, document precisely what was and wasn't verified rather than claiming an unverified success.

- [ ] **Step 3: Update the ADE coordination ledger**

Modify `.claude/ade-coordination.md` — change the `feat/dashboard-ui-port` row's Status from `Dispatched` to `Done`.

- [ ] **Step 4: Commit**

```bash
git add .claude/ade-coordination.md
git commit -m "chore: mark dashboard-ui-port complete in ADE coordination ledger"
```

- [ ] **Step 5: Hand off**

Given the security-sensitive nature of this port (auth-scoped queries, multi-tenant data), confirm with the user before merging even though the auto-merge policy nominally allows it once tests pass — a human look at the Step 2 authenticated verification is warranted before this touches `main`.
