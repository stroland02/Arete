# Dashboard UI Port — Design Spec

**Date:** 2026-07-11
**Status:** Approved for planning
**Branch:** `feat/dashboard-ui-port`
**Package owned:** `dashboard` (see `.claude/ade-coordination.md`)
**Scope:** `packages/dashboard` presentation layer, plus one new additive function in `src/lib/queries.ts`

---

## 1. Context — why this exists

`feat/dashboard-ui-redesign` (merged design system: tokens, shadcn-style primitives, Framer Motion, the agent-orchestration graph — see `docs/superpowers/specs/2026-07-10-dashboard-ui-redesign-design.md` and its round-2 elevation plan) was built against a version of `packages/dashboard` that no longer exists on `main`. While that work was in progress, `main` was independently restructured:

- **`packages/db` extraction** (`@arete/db`): Prisma schema, migrations, and generated client moved out of `packages/dashboard` into a shared workspace package. `Installation`/`Repository` are now keyed by a `ScmProvider` enum + `externalId`; `ReviewComment` gained a `createdAt` field.
- **Real authentication**: NextAuth.js (Auth.js v5) GitHub OAuth login, a `proxy.ts` route gate, and a `/login` page. The dashboard previously had zero auth and every query was global — a real cross-tenant data leak. This is now fixed.
- **Route restructure**: the actual page/layout moved to `app/(dashboard)/page.tsx` and `app/(dashboard)/layout.tsx` (a route group), with a thin top-level `app/layout.tsx`.
- **`getDashboardViewModel(db, installationIds)`** in `src/lib/queries.ts` is now the single choke point all dashboard queries must go through — every query scoped to `repository: { installationId: { in: installationIds } } }`. It already computes real week-over-week change values (`totalPrsChange`, `criticalBugsChange`, `repoDelta`, `weeklyDelta`) — better than what the redesign branch built.
- **A real vitest suite** for `@arete/dashboard` now exists (`queries.test.ts`, `installations.test.ts`, `installation-cache.test.ts`, `proxy.test.ts`, `EmptyState.test.tsx`), following an established convention: an in-memory fake Prisma proving the real query-building function's tenancy-scoping property (mirrors `packages/webhook/src/tenancy.test.ts`).
- `app/(dashboard)/page.tsx` and `layout.tsx` on `main` are still visually the **original, pre-redesign** UI (raw Tailwind colors, no tokens, no Framer Motion, no design-system components) — someone added real auth/multi-tenancy on top of the old UI, independently of the redesign work.
- A separate, unrelated `components/EmptyState.tsx` already exists at the top level — shown when an authenticated user has zero authorized installations (`hasAccess: false`). Different purpose from the redesign's per-panel `components/dashboard/empty-state.tsx` (empty lists within an authorized session). No file collision; different import paths, never imported into the same file.

A `git rebase`/`merge` of the old redesign branch is not viable — its commits touch file paths (`packages/dashboard/src/app/page.tsx`, `prisma/schema.prisma`, `src/lib/db.ts`) that no longer exist in this shape. This spec instead **ports** the finished design system onto the current, correct (auth-scoped, secure) data layer.

## 2. What ports unchanged

Everything in the design system that doesn't depend on the old data shape moves over as-is:
- `src/app/globals.css`'s token layer (`@theme inline` block: `surface-*`, `border-*`, `accent-*` incl. `accent-secondary`, `content-*`, easing vars) and the `.glass-panel`/`.glass-panel-interactive`/`.glass-panel-active` rules — `main`'s `globals.css` is still the pristine pre-redesign file, so this is a clean addition, not a merge.
- `src/lib/motion.ts`, `src/lib/utils.ts` (`cn()`).
- `src/components/ui/*` (Button, Card, Badge, Skeleton, Tooltip) — unchanged, no data dependency.
- `src/components/dashboard/*` presentational components (Sparkline, MetricsGrid, ActivityList, Sidebar, Topbar, DashboardShell, AgentOrchestrationGraph, CategoryBreakdown, EmptyState, CountUpValue, PageReveal/RevealItem) — unchanged, since they all take plain props, per the original design's explicit principle of keeping presentation decoupled from data-fetching.

## 3. What gets rewritten

### 3.1 One new, narrow, additive query function

Add `getTrendSeries(db, installationIds)` to `packages/dashboard/src/lib/queries.ts`, next to (not modifying) `getDashboardViewModel`. Same scoping pattern (`repository: { installationId: { in: installationIds } }`), returning:
```ts
export interface TrendSeries {
  reviewDates: Date[];
  repoDates: Date[];
}
export async function getTrendSeries(db: PrismaClient, installationIds: string[]): Promise<TrendSeries>
```
`bucketByDay`/`cumulativeByDay` (moved from the old `page.tsx` into a small shared helper module, e.g. `src/lib/trends.ts`) consume this data inside the `page.tsx` server component, exactly as they did in the original design — no client-side fetch involved. If `installationIds` is empty, return empty arrays (mirrors `getDashboardViewModel`'s `hasAccess: false` short-circuit — the caller won't invoke this when there's no access anyway).

A test is added to `queries.test.ts` in the file's own established convention (the in-memory fake-Prisma proving tenancy scoping) — not a new test style.

### 3.2 `app/(dashboard)/page.tsx` — full rewrite

Keeps unchanged: the `auth()` session check, `redirect("/login")` for no session, `resolveSelectedInstallationIds`, the `hasAccess` check rendering the top-level `EmptyState` (no-installations case), and `export const dynamic = "force-dynamic"`.

Replaces: calls `getDashboardViewModel` (unchanged) **and** the new `getTrendSeries`, then renders through the design system:
- Metrics: `MetricsGrid` fed from `viewModel.totalPrs/criticalBugs/recentReviews/activeRepos` and their **real, already-computed** `totalPrsChange`/`criticalBugsChange`/`weeklyDelta`/`repoDelta` — the old branch's own honesty-derivation code (round 2's "+N this week" logic) is deleted in favor of consuming these directly, since they're server-computed and equally honest. Sparklines for Total PRs / Active Repositories come from `getTrendSeries` via `bucketByDay`/`cumulativeByDay`; Critical Bugs Prevented still has no sparkline — but the reason changes: `ReviewComment` now *does* have `createdAt` on `main`, so this is now a deliberate scope choice (no query changes beyond the two functions already planned) rather than a genuine impossibility. Documented in a code comment as such.
- `AgentOrchestrationGraph` fed `activeRepos`/`totalPrs` directly from the view model (no change needed — the props already match).
- `CategoryBreakdown` fed `viewModel.commentsByCategory` (already shaped as `{ category, count }[]`, matching the component's existing prop type exactly).
- `ActivityList` fed `viewModel.latestReviews`, mapping `repositoryFullName` (already flattened on the view model — no `.repository.fullName` nesting) → the component's expected shape.
- `PageReveal`/`RevealItem` entrance choreography, the de-duplicated page title, wraps the whole thing as before.

### 3.3 `app/(dashboard)/layout.tsx` — full rewrite

Keeps unchanged: the `auth()` session check + redirect, reading `session.installations` and `session.user`.

Replaces: renders `DashboardShell`/`Sidebar`/`Topbar` instead of the old plain `<aside>`/`<main>`. The real `InstallationSwitcher` (when `installations.length > 1`) and `SignOutButton` are slotted into `Sidebar` exactly where `main`'s current layout places them (switcher below the wordmark, sign-out beside the user info), replacing the redesign's placeholder "User Account / Pro Plan" block with the real session-derived name/initial.

### 3.4 Light-touch reskin of auth UI

`InstallationSwitcher`, `SignOutButton`, `app/login/page.tsx`, and the top-level `components/EmptyState.tsx` (`hasAccess: false` case) get their raw Tailwind colors (`text-slate-400`, `bg-indigo-500/10`, etc.) swapped for the design system's tokens (`text-content-muted`, `bg-accent-primary/10`, etc.) so they sit visually consistent inside the new shell. **Behavior, structure, props, and test coverage (`EmptyState.test.tsx`) are untouched** — this is a class-name-only pass, not a redesign, per the earlier scope decision.

## 4. Explicitly out of scope

- Full creative redesign of `InstallationSwitcher`/`SignOutButton`/login page (light-touch reskin only, per decision above).
- `/history`, `/settings` routes — still don't exist, still deferred.
- Any change to `getDashboardViewModel`'s existing behavior, shape, or tests.
- Any change to `packages/db`, `packages/agents`, `packages/webhook`, or `infra/`.
- Schema changes of any kind (no `prisma migrate`/`db push` against the shared schema).

## 5. Testing & verification

- `pnpm --filter @arete/dashboard build` → 0 errors. (The page is `force-dynamic`, so there's no static-prerender step to worry about the way round 1/2 did against the scratch DB — build just needs to typecheck/compile.)
- `pnpm --filter @arete/dashboard lint` → 0 new errors (the 2 pre-existing `react-hooks/purity` errors are gone in this codebase already — need to re-check on `main`'s current `page.tsx`; if `main`'s rewritten data-fetching avoids the `Date.now()`-in-render pattern, don't reintroduce it).
- **`pnpm --filter @arete/dashboard test` (vitest) → the real new gate.** Existing suite (`queries.test.ts`, `installations.test.ts`, `installation-cache.test.ts`, `proxy.test.ts`, `EmptyState.test.tsx`) must stay green, plus the new `getTrendSeries` test.
- Manual verification requires a real or faked authenticated session (NextAuth JWT) against a seeded scratch DB with at least one authorized Installation — since the page is `force-dynamic` and gated by `auth()`, the previous rounds' "just hit `/` on an empty DB" approach won't reach the dashboard content at all (it'll redirect to `/login`). The implementation plan must include a concrete way to exercise this (e.g. a test-only session cookie, or driving the real OAuth flow against a test GitHub OAuth app if one is already configured — investigate `lib/auth.ts` / existing `.env.example` during planning).

## 6. Isolation & workflow

- Branch `feat/dashboard-ui-port`, worktree `.worktrees/dashboard-ui-port`, branched from local `main` (which is 12 commits ahead of `origin/main`, none touching `packages/dashboard` — confirmed before branching).
- Declared in `.claude/ade-coordination.md`.
- The old `feat/dashboard-ui-redesign` branch/worktree is not merged and not deleted by this work — left as a historical record of the design decisions, superseded by this port.

---

*Next step: transition to the writing-plans skill to turn this spec into a step-by-step implementation plan.*
