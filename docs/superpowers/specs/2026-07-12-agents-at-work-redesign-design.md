# "Agents at Work" Redesign — Design Spec

**Date:** 2026-07-12
**Status:** Approved design (drawer + controls-now/save-later), pending build
**Branch:** continues on `feat/arete-account-auth`

## Context

The overview's "Agents at work" panel is currently a bespoke SVG orchestration
graph (`packages/dashboard/src/components/dashboard/agent-orchestration-graph.tsx`)
— six agent circles → a Synthesizer hub → "Posted to PR", with animated
edge dots. The user wants it to read as a **professional, structured product
surface**, not a diagram: uniform agent **cards** with real detail, a central
**hourglass "project-manager" Synthesizer**, and a clearer **PR/merge phase** —
all in the **existing site theme** (glass panels, indigo/cyan tokens, Framer
Motion; no new art style), visually uniform and symmetrical.

## Grounding (what is real)

- **Per-agent model tier** is real config (`packages/agents/src/arete_agents/config.py`):
  opus (`claude-opus-4-8`) for security, business_logic, deployment_safety,
  ci_diagnostics, synthesizer; sonnet (`claude-sonnet-5`) for performance,
  quality, test_coverage, chat. It's server config today — **not per-tenant
  editable**. The cards display it; the drawer's editable controls are not yet
  persisted.
- **Synthesizer logic** (`orchestrator.py` `SynthesizerAgent`, `models/review.py`):
  merges all agents' findings, verifies each against the diff, **drops
  low-confidence/hallucinated ones** (`dropped_count`), marks the run
  `analysis_status` `complete`/`failed`; survivors post to the PR. The
  hourglass copy mirrors exactly this.
- **No live per-agent streaming status** exists — a review runs per-PR. So
  "what it's doing" is truthful when derived from the latest review
  (Idle / Analyzed · N findings / No findings), not a fake real-time feed.

## Decisions

- **Click target:** right-side **slide-in drawer** (stay in context on the overview).
- **Config depth:** render the full config drawer with **interactive controls**
  (enable/disable, severity threshold, custom guidance) now, but **honestly
  marked "not saved yet"** (disabled Save + a one-line note) until a
  per-installation settings store is built (explicit follow-up). Informational
  content (role, tier, what it inspects, recent findings) is real.

## Architecture

New client-composed section replacing the SVG graph inside the "Agents at
work" card. Give the section **full width** (its own row in the overview) so
the grid + hourglass + PR breathe; keep the existing "What we caught for you"
feed as its own panel below.

### Components (all in `components/dashboard/agents/`)

1. **`agent-catalog.ts`** — the single source of truth array `AGENTS` (extend
   the existing `AGENT_DEFS`): `{ id, label, description, longDescription,
   inspects: string[], tier: "opus"|"sonnet", icon }`. Tier values match
   config.py defaults. Exported for reuse + tests.

2. **`AgentCard`** (`agent-card.tsx`, client) — the uniform card.
   Props: `{ agent: Agent; findingCount: number; hasReviews: boolean;
   onOpen: (id: string) => void }`.
   Renders: header (icon in a tinted square + name + **tier badge**), role
   description (2-line clamp), a **status row** (dot + `Idle` when
   `!hasReviews`, else `Analyzed · N finding(s)` / `No findings`), and a
   category/finding chip. Full card is a button → `onOpen(agent.id)`; hover
   lift via existing motion. Reuses `Card`/`Badge` ui primitives + tokens.

3. **`AgentConfigDrawer`** (`agent-config-drawer.tsx`, client) — right-side
   drawer. Props: `{ agent: Agent | null; findingCount: number;
   onClose: () => void }`. Sections: identity (icon, name, tier badge),
   "What it does" (longDescription + `inspects` list), "Recent activity"
   (finding count / status), and **Configuration**: an enable/disable toggle,
   a severity-threshold select (info/warning/error), a custom-guidance
   textarea. A disabled **Save** button + a subtle note: *"Agent settings
   aren't saved yet — per-repository configuration is coming soon."* Controls
   are locally interactive (useState) but do not persist. Animate in/out with
   Framer Motion; overlay scrim; Esc/scrim-click closes. Accessible (role,
   focus, aria-label).

4. **`SynthesizerHourglass`** (`synthesizer-hourglass.tsx`, client) — the
   central "project manager." An hourglass motif (SVG, existing accent
   tokens; top bulb = incoming findings, neck = verification, bottom bulb =
   posted) with a **live caption** mirroring real logic, e.g.
   `Merging {total} findings → verifying → dropped {dropped} → {kept} posted`
   (values derived from props; when no data, a calm idle caption). Clickable →
   opens a small info panel / reuses the drawer pattern explaining the
   verify-and-drop contract (`dropped_count`, `analysis_status`).
   Props: `{ totalFindings: number; hasReviews: boolean }` (dropped/kept are
   illustrative from available data; do NOT fabricate — if we don't have a
   real dropped count on the overview, show the contract descriptively rather
   than a fake number).

5. **`PrOutcomePanel`** (`pr-outcome.tsx`, client) — the PR/merge phase. A
   clean stepped panel: Verified findings → Posted as PR review comments →
   Your merge decision, with small honest step icons (shield-check / git-pull-
   request / git-merge). Static/illustrative; no fake CI graph.

6. **`AgentsAtWork`** (`agents-at-work.tsx`, client) — the container. Props:
   `{ agents: Agent[]; findingCountById: Record<string, number>;
   totalFindings: number; hasReviews: boolean }`. Lays out a **2×3 (lg) /
   1-col (mobile) grid of `AgentCard`** on the left, the `SynthesizerHourglass`
   in the middle, `PrOutcomePanel` on the right (responsive: stack on small
   screens). Owns `selectedAgentId` state and renders the `AgentConfigDrawer`.
   Symmetric spacing, uniform card heights.

### Data flow

`overview/page.tsx` already computes `commentsByCategory: CategoryCount[]`,
`totalPrs`, and the zero-state. Map `commentsByCategory` → `findingCountById`
and `totalFindings`, pass `hasReviews = connected && totalPrs > 0`, and render
`<AgentsAtWork ... />` inside the "Agents at work" card (full-width row). The
old `AgentOrchestrationGraph` import/usage is removed.

## Theme & consistency

Reuse existing design tokens (`surface-*`, `accent-*`, `content-*`,
`border-*`, `.glass-panel`), `Card`/`Badge`/`Button`, and the motion helpers
in `lib/motion.ts`. Per-agent accent: a single subtle tint per card (keep it
uniform — not six loud colors), tier badge uses accent-primary (opus) vs
accent-secondary/muted (sonnet). Cards are identical in size/structure for
symmetry.

## Error / empty states

- No reviews yet (zero-state): cards render with `Idle` status and 0 findings;
  hourglass shows the idle caption; PR panel shows the steps in a muted state.
  Nothing fabricated.
- Drawer with no recent findings: "No recent findings from this agent."

## Testing (vitest, node env, `renderToStaticMarkup`)

- Replace `agent-orchestration-graph.test.tsx` with `agents-at-work.test.tsx`
  (or per-component tests): assert an `AgentCard` renders its name, tier badge,
  and a status string; assert `AgentsAtWork` renders all six agents and the
  synthesizer caption; assert the drawer markup contains the config controls +
  the "not saved yet" note. Keep the full suite green
  (`pnpm --filter @arete/dashboard test`) + `tsc --noEmit`.

## Out of scope (explicit follow-ups)

- **Persisting** agent settings (per-installation store: DB + API + agents
  wiring) — the drawer controls are non-persistent this build.
- **Live/streaming** per-agent run status (needs backend run-status events).
- Deep per-agent analytics pages.
