# Overview Page Cleanup + Setup Path — Design Spec

**Date:** 2026-07-12
**Status:** Approved design, pending build
**Branch:** to be created off `main` (does not touch `feat/arete-account-auth`)

## Context

The user reported the dashboard Overview page looks "sloppy" with "duplicate
windows" and "too much going on." Investigation confirmed a real duplication
bug that exists on the in-progress `feat/arete-account-auth` branch (not yet
merged to `main`): it added a new `MetricsGrid` component (4 SuperLog-style
cards — Total PRs Reviewed, Critical Issues Caught, Reviews This Week, Active
Repositories) directly above the pre-existing `ValueLedger` component (3
cards — Critical issues caught, Pull requests reviewed, Reviews this week).
The same three numbers render twice, back-to-back, in two different visual
styles.

That branch also already built real, reusable pieces worth keeping:
`MetricsGrid` (`packages/dashboard/src/components/dashboard/metrics-grid.tsx`),
`CommentsByCategory` (category breakdown chart), and moved "Agents at work"
out of Overview into a new dedicated `/agents` 3-pane workspace page. None of
this is merged to `main` yet.

The user wants Overview to be a simple, clean view of important
transactions/metrics, with a real analytics visual (SuperLog-style), and a
setup/onboarding path that guides them through connecting everything needed
for fully-orchestrated reviews — modeled on SuperLog's real Overview pattern
(see `docs/design-references/superlog-product/01-overview-sample-data-banner.png`:
a persistent "You're exploring sample data — Connect your own app" banner
above an "Active Critical Incidents" summary).

## Decisions

- **Build on top of `feat/arete-account-auth`'s Overview work** (cherry-pick
  the relevant files or branch off it once its auth-only portion is already
  on `main` — it is) rather than starting fresh, to avoid a fourth competing
  rebuild of the same page. Do not touch that branch's `/agents` workspace
  work — only the Overview page composition changes here.
- **Fix the duplication** by deleting `ValueLedger`'s three `ValueCard`s
  entirely, keeping only its quiet greeting line, and keeping `MetricsGrid`
  as the single metrics row (it already includes Active Repositories, which
  `ValueLedger` lacked).
- **Setup checklist is real, not fabricated.** Every checked/unchecked state
  reflects an actual queryable fact. "Create your Areté account" is honestly
  pre-checked (the user is authenticated by definition on this page) — this
  gives the same "endowed progress" psychological effect the user asked for
  (starting above 0%) without inventing any state. No item is ever shown
  checked before its underlying condition is true.
- **Agents at work is fully removed from Overview**, matching the
  `feat/arete-account-auth` branch's `/agents` page relocation — this is the
  single biggest contributor to today's clutter.

## Architecture

New client-composed section at the top of
`packages/dashboard/src/app/(dashboard)/overview/page.tsx`, plus edits to
existing components. No new backend endpoints — all data already exists in
`getDashboardViewModel` / `getConnectedTelemetryProviders`.

### Components

1. **`SetupChecklist`** (new, `components/dashboard/setup-checklist.tsx`,
   client). Props:
   ```ts
   interface SetupStep {
     id: string;
     label: string;
     done: boolean;
     href?: string; // where to go to complete it
   }
   interface SetupChecklistProps {
     steps: SetupStep[]; // always 4, in fixed order
   }
   ```
   Renders a glass-panel card: a progress bar/percentage (`doneCount / steps.length`),
   a headline ("Get fully orchestrated reviews" or similar, honest — no
   fabricated urgency copy), and the 4 steps as a vertical list (checkmark or
   empty circle, label, and a "Connect" / "Go" link for incomplete ones).
   When `doneCount === steps.length`, the component renders a small
   dismissible collapsed strip instead ("Setup complete ✓" + a close button)
   rather than disappearing outright. Collapsed/dismissed state persists via
   a `localStorage` flag keyed by installation id (client-only, no schema
   change) — reappears if a later step somehow becomes un-done (should not
   happen in practice, but avoids permanently hiding stale state).

2. **`MetricsGrid`** (existing, from `feat/arete-account-auth` — no changes).

3. **`ValueLedger`** (modify): strip out the 3 `ValueCard`s and the
   `ValueCard` sub-component entirely; keep only the greeting `<h1>`/date
   line. Rename the exported component's responsibility in a doc comment
   (still called `ValueLedger` to minimize churn, or rename to `PageGreeting`
   if that reads more clearly at implementation time — implementer's call,
   note it either way in the PR).

4. **`CommentsByCategory`**, **`ActivityList`**, **`ConnectorHealthStrip`**
   (existing, from `feat/arete-account-auth` / current `main` — no changes).

### Data flow

`overview/page.tsx` already computes `connected` (from `viewModel.hasAccess`),
`telemetryProviders` (via `getConnectedTelemetryProviders`), and `totalPrs`.
Derive the 4 `SetupStep`s directly in the page component:

```ts
const setupSteps: SetupStep[] = [
  { id: "account", label: "Create your Areté account", done: true },
  { id: "repo", label: "Connect your GitHub repository", done: connected, href: "/connections" },
  { id: "telemetry", label: "Connect a telemetry source", done: telemetryProviders.length > 0, href: "/connections" },
  { id: "first-review", label: "See your first automated review", done: totalPrs > 0 },
];
```

No new queries — `telemetryProviders` is already fetched via
`getConnectedTelemetryProviders(db, installationIds)` (already imported on
`main`'s current `overview/page.tsx`; must be re-added if building from a
version of the file that dropped it).

### Final page composition (top to bottom)

1. `SetupChecklist` (always rendered; collapses when complete + dismissed)
2. `ValueLedger` (greeting line only)
3. `MetricsGrid` (single 4-card metrics row)
4. Two-column: `CommentsByCategory` + `ActivityList`
5. `ConnectorHealthStrip`

The existing zero-state "Connect a repository" banner
(`!connected && (...)`) is removed — the new `SetupChecklist`'s "Connect your
GitHub repository" step supersedes it (same destination, `/connections`,
better integrated into one coherent setup story instead of two separate
nudges).

## Error / empty states

- No reviews yet: `SetupChecklist` shows 1-2 of 4 done (honest); `MetricsGrid`
  shows real zeros; `CommentsByCategory` and `ActivityList` render their
  existing empty states (already built, already honest — not touched here).
- All 4 steps done: checklist collapses to the dismissible strip described
  above.

## Testing (vitest, node env, `renderToStaticMarkup`)

- `setup-checklist.test.tsx`: renders all 4 steps with correct done/undone
  state from props; renders the collapsed strip when all steps are done;
  never renders a step as done when its prop is false (guards against
  accidental fabrication).
- Update `overview` page test coverage (if any exists) to assert
  `ValueLedger`'s 3 duplicate cards are gone and only one `MetricsGrid`
  renders.
- Keep the full suite green: `pnpm --filter @arete/dashboard test`, plus
  `tsc --noEmit` and `next build`.

## Out of scope

- Persisting the checklist-dismissed state server-side (localStorage is
  sufficient for a v1 — no new schema).
- Changing anything on the `/agents` workspace page itself — that is
  `feat/arete-account-auth`'s active territory, left untouched.
- A numeric "percentage" beyond the real `doneCount/4` fraction — no
  inflated or estimated progress values.
