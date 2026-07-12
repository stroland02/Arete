# Agents Workspace (Orca-style) + Overview Analytics — Design Spec

**Date:** 2026-07-12
**Status:** Approved design, building
**Branch:** continues on `feat/arete-account-auth`

## Context

Two changes, driven by the user + two Orca reference screenshots:

1. **Move the agents experience to a dedicated `/agents` page** structured like
   **Orca** — a full-height **3-pane workspace**: agents on the **left**, an
   interactive **Synthesizer console/chat** in the **center**, **pull-request
   information** on the **right**.
2. **Reclaim the overview** for **SuperLog-style analytics dashboards** (the
   agents block leaves the overview).

### Orca reference (what to mirror)

- **Very dark, dense, developer-tool** aesthetic; thin separators; small text;
  status **dots** (green active / amber attention / muted idle); collapsible
  sections with chevrons; tab toggles; a primary action button.
- **Left rail:** sectioned navigator; each row = item + subtitle + timestamp;
  the active row highlighted.
- **Center:** a **transcript/console** with step markers (● steps, ✳/*
  status lines like "Baked/Churned/Hatching"), collapsible detail, and an
  **input bar pinned to the bottom** with mode hints
  (`bypass permissions on · esc to interrupt · ← for agents`).
- **Right:** a **contextual panel** that can show git (Create PR button,
  `vs origin/main ↑15 ↓6`, file rows with `+adds/−dels` + status letter,
  Commits) or a files tree (header, Find-files search, Names/Contents tabs,
  chevron rows). Mirror this collapsible-sections + header/tabs style.

## Decisions (from the user)

- **Chat center = polished UI shell** now (not wired to a live model); wire to
  the real `ChatAgent` as the immediate follow-up.
- Existing site theme/tokens (dark glass, indigo/cyan) — apply the Orca
  density on top of the current design system, not a brand-new palette.

## Honesty constraints

On a fresh account (no GitHub linked — deferred spec), the PR panel, the
console transcript, and overview metrics show **clean illustrative/zero
states**, never fabricated data. The console shell shows a scripted, clearly
non-live demonstration of the workflow narration (labeled as a preview) or an
idle empty state — it must not imply a live model is answering.

## Architecture — `/agents` page

**Route:** `src/app/(dashboard)/agents/page.tsx` (gated, inside the
`(dashboard)` group so it inherits the shell). Server component: `auth()`
guard + `redirect('/login')`; read `getDashboardViewModel` for
`commentsByCategory` (per-agent finding counts) and `latestReviews`; compute
`hasReviews`. Render a full-height client `<AgentsWorkspace>`. Use
`export const dynamic = "force-dynamic"` like the overview.

Because this is a full-bleed 3-pane workspace, it may need more width than the
standard content padding — render it to fill the shell's content area
(min-height to viewport, internal scroll per pane).

### Components (`src/components/dashboard/agents/`, reuse existing `agent-catalog.ts`)

1. **`AgentsWorkspace`** (`agents-workspace.tsx`, client) — 3-column grid
   (`lg:grid-cols-[260px_1fr_320px]`, stacks on small screens), full height,
   each column independently scrollable with its own header. Owns
   `selectedAgentId` (defaults to first agent). Props:
   `{ findingCountById: Record<string, number>; totalFindings: number;
   hasReviews: boolean; latestReview?: { repoFullName: string; prNumber: number;
   riskLevel: string } | null }`.

2. **`AgentRail`** (`agent-rail.tsx`, client) — left pane. Header "Agents".
   Each agent = an Orca-style row: **status dot** (idle muted / active green),
   icon, name, **tier badge**, and a subtitle line (e.g. `Sonnet ·
   {findingCount} findings` or `Idle`). Selected row highlighted (left accent
   bar + tint). Clicking selects (drives center/right). A small gear on hover
   opens the existing `AgentConfigDrawer` (reuse it) for that agent.

3. **`SynthesizerConsole`** (`synthesizer-console.tsx`, client) — center pane.
   Header "Synthesizer" + a subtle "Preview" chip (honest: not live). A
   scrollable **transcript** of workflow steps styled like Orca's console —
   step rows with ● markers and status lines mirroring the real contract:
   `● Security flagged 2 issues` → `✱ Verifying against the diff…` →
   `● Dropped 1 low-confidence finding` → `✓ 6 findings posted to the PR`.
   When `!hasReviews`, show an idle empty state ("No active review — connect a
   repository to watch the Synthesizer work"). Pinned **input bar at the
   bottom** ("Ask the Synthesizer…", disabled/placeholder with a hint that
   live chat is coming) styled like Orca's input strip. Focus the selected
   agent's steps when one is selected.

4. **`PrPanel`** (`pr-panel.tsx`, client) — right pane. Orca git-panel style:
   header with a primary **"View PR"** button; a `repo · PR #{n} · vs main`
   comparison line (or "No pull request yet" when none); collapsible sections
   **Findings** (severity dot + `path:line` + category), **Files changed**
   (path + `+adds/−dels`), **Commits** (short hash + subject). Illustrative/
   zero-state when no real PR data.

### Nav

Add an **"Agents"** entry to `src/components/dashboard/sidebar.tsx` (between
Overview and the rest), linking `/agents`, with a fitting icon
(e.g. `IconRobot` / `IconTopologyStar3`).

## Architecture — Overview analytics (SuperLog style)

In `src/app/(dashboard)/overview/page.tsx`, **remove** the `<AgentsAtWork>`
block (it now lives on `/agents`). Keep the zero-state banner + `ValueLedger`
hero + activity feed + `ConnectorHealthStrip`. **Add**:

- A **metrics grid** using the existing `components/dashboard/metrics-grid.tsx`
  (Critical issues caught / PRs reviewed / Reviews this week — real values from
  the view model, matching the branded mockup).
- A new **`CommentsByCategory`** component
  (`components/dashboard/comments-by-category.tsx`, presentational): horizontal
  labeled bars per category with counts (Performance, Security, Testing,
  Maintainability, Style…), colors from existing tokens, driven by
  `commentsByCategory`. Empty state when none. This is the mockup's "Comments
  by Category" panel.

Lay the overview out as a professional analytics dashboard (hero → metrics grid
→ two-column: category breakdown + activity feed → connectors), symmetric and
consistent with the design system.

## Testing (vitest, node env, `renderToStaticMarkup`)

- `AgentRail` renders all six agent names + tier badges + a status string.
- `SynthesizerConsole` renders the input bar and, given `hasReviews`, the
  step-narration text; idle state otherwise.
- `PrPanel` renders the Findings/Files/Commits section headers; "No pull
  request yet" when none.
- `CommentsByCategory` renders a bar + count per category; empty state on `[]`.
- Keep the full suite green (`pnpm --filter @arete/dashboard test`) + `tsc
  --noEmit`. The prior `agents-at-work.*` components/tests remain (still used
  as building blocks / config drawer); only the overview's *usage* of
  `AgentsAtWork` is removed.

## Out of scope (explicit follow-ups)

- Wiring the console to the real `ChatAgent` (API route + streaming).
- Real PR data (needs GitHub-account linking, deferred spec).
- Persisting agent config settings.
