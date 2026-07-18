# Dashboard Refinement — Services + Dashboards (Marble & Ink polish)

**Date:** 2026-07-17
**Author:** Engineer 2
**Lane:** `packages/dashboard` (shared-additive) · lands on `feat/wave2-fix-ui` · pushed at checkpoint, PM integrates
**Status:** Design — awaiting review

## Goal

Raise the visual quality and information design of the two surfaces engineers
live in for PR-patching / code-healing work — the **Services "Triage Inbox"**
and the **Dashboards** — to a Linear/Vercel grade of restraint and clarity,
*without* re-theming. Same Marble & Ink palette and type; much stronger
hierarchy, density, and glanceable status, plus purposeful motion.

## Non-goals

- No new theme, palette, or font. Marble & Ink tokens (`globals.css`) are the
  contract; components consume tokens, never hard-coded colors.
- No changes to `@arete/db` schema, `packages/webhook`, `packages/agents`, or
  `orchestration/src/status.ts`.
- No new runtime dependencies. `framer-motion@^12` and `@tabler/icons-react`
  are already present.
- Not touching Agents, Connections, History, Overview, Settings this pass
  (they inherit the shared primitives later).

## Global constraints (verbatim, apply to every task)

- **Anti-fabrication (aletheia):** every count, severity, and status derives
  from real data. Empty renders honestly empty (no skeleton masquerading as
  data, no invented rows/counts). Sample/marketing mode stays visibly sample.
- **Both themes** must be deliberately correct (light default + dark). Style
  through tokens so both follow automatically.
- **`prefers-reduced-motion`** fully honored — all motion degrades to no-op.
- **Keyboard:** every interactive element keeps a visible `focus-visible` ring.
- **Tests:** existing vitest suite (`environment: 'node'`,
  `renderToStaticMarkup`, no testing-library) stays green. New *pure*
  view-models get unit tests.
- **Next.js is non-standard** (16.2.10) — consult `node_modules/next/dist/docs/`
  before any framework-level code; this work is component-level.

## Design language

Warm-paper ground (`surface-0`), raised-paper cards (`surface-1/2`), ink text,
single cobalt `accent-primary`, **semantic** `accent-danger/warning/info/success`
for severity — kept distinct from the brand accent. JetBrains Mono for all
code, PR numbers, repo names, and IDs. `tabular-nums` wherever digits align.
12px card radius, restrained shadows, hover-lift only on genuinely actionable
cards (existing `.glass-panel*` conventions).

---

## A · Services "Triage Inbox"

File: `src/components/dashboard/services/services-workspace.tsx` (+ new small
components). Keeps its 3-pane layout (260px rail / Synthesizer center / 320px
detail).

### A1 — Triage command bar (signature)

A thin header strip above the three panes answering *"what needs me now?"*:
three chips — **Awaiting approval · In flight · Blocked** — each with an
animated count (reuse `count-up-value`) and its semantic tone.

- New pure view-model `deriveTriage(...)` computing the three counts from the
  real inputs (`reviewGroups` in real mode; `services`/`issues` in sample
  mode). Unit-tested.
- Honest zeros: when nothing is awaiting, the chip reads `0` in muted tone,
  never hidden-to-imply-activity and never faked. In the not-connected empty
  state the bar shows all zeros with a quiet "nothing waiting on you" caption.
- New component `TriageBar` consuming the view-model. Motion: count-up on
  mount/update; reduced-motion → static number.

### A2 — Elevated diff / patch panel (signature)

The proposed-fix code block in `IssuePanel` becomes a real review surface.

- New component `DiffView({ file, rows })` (extracted + upgraded from the
  inline `pre` at services-workspace.tsx:877–889):
  - line-number gutter (mono, muted, `tabular-nums`, `select-none`)
  - a `+N −M` change summary derived from the rows (pure helper, tested)
  - refined add/remove tinting via `accent-success/danger` at low alpha;
    context lines muted
  - a copy-patch affordance that copies the reconstructed patch text
- Horizontal overflow scrolls inside the panel (`overflow-x:auto`), page never
  scrolls sideways.

### A3 — Rail + row polish (supporting)

- Consistent row height/density across real + sample rails; `focus-visible`
  rings on every row button; the active-row accent stripe stays.
- Expand/collapse of a service/repo animates height via
  `AnimatePresence`/`motion` (reduced-motion → instant).

---

## B · Dashboards

Files: `src/components/dashboard/dashboards/*`, `src/components/ui/card.tsx`,
`src/components/dashboard/activity-list.tsx`, `sparkline.tsx`.

### B1 — Data table redesign (signature)

The reviews table (`ActivityList` used by `TableWidget`) → a scannable,
Linear-grade data table.

- Per-row **severity stripe** (left 2px bar, semantic tone by risk).
- **risk pill** (reuse the `SEV_PILL`/`riskPill` convention already in
  services), mono repo + `PR #n`, right-aligned relative time with
  `tabular-nums`.
- Aligned columns, crisp `hover:bg` row highlight, generous-but-dense rows.
- Honest empty state preserved (`Widget` `isEmpty`).
- New shared `SeverityStripe` + a small relative-time helper (pure, tested).

### B2 — Stat cards (supporting)

Metric widgets (`metric-widget.tsx`, `telemetry-metric-widget.tsx`) → glanceable
KPIs: large `tabular-nums` figure with count-up, optional inline `sparkline`
trend, and a delta chip with a direction arrow + semantic color (up-good vs
up-bad decided by the metric, passed in — never assumed).

### B3 — Timeseries polish (supporting)

`timeseries-widget.tsx` / `sparkline.tsx`: soft area fill under the line, faint
gridlines, emphasized endpoint dot, gentle draw-on (reduced-motion → drawn
instantly). No fabricated data — zero series still renders the honest empty
frame.

### B4 — Controls polish (supporting)

Preset tab bar (`dashboards-workspace.tsx`) and `time-range-control.tsx` tightened
to a consistent segmented-control treatment with `focus-visible` states.

---

## Shared primitives (additive; both surfaces + future adopters)

- `SeverityStripe` — the left severity bar, one source of truth.
- `DiffView` — the elevated diff surface (A2), reusable anywhere a patch shows.
- `TriageBar` + `deriveTriage` — the command bar and its pure model.
- `StatCard` — the KPI card (B2), built on existing `Card`.
- Reuse existing `count-up-value.tsx` and `sparkline.tsx`; extend, don't
  duplicate.

Each new pure helper (`deriveTriage`, diff `+N −M`, relative-time) is unit-tested
against the existing vitest setup.

## Testing strategy

- Pure view-models/helpers: direct unit tests (`describe/it/expect`).
- Components: `renderToStaticMarkup` assertions for presence of honest
  empty/zero states and semantic classes (matches the existing suite style,
  e.g. `status-board.test`, `widgets.test`).
- Full suite must stay green; report the new count at checkpoint.

## Rollout

Small, independently-committable tasks (one signature or supporting item each),
each ending green. Pushed to `feat/wave2-fix-ui` at checkpoints; PM integrates.
No self-merge.
