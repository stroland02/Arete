# Code Map v2 (Sensorium polish) — Design

**Date:** 2026-07-17 · **Owner:** Engineer-1 · **Status:** Approved by PM (design review in chat)

## Goal

Replace the current basic node-graph render of the code map (`sensorium-map.tsx`, shown as
"Code map" on `/overview`) with a modern, sleek, Marble & Ink–native **folder-cluster map**:
files grouped inside clickable folder regions, calm aggregated edges, and a slide-over
sidebar showing a clicked file/folder's health, contents, dependencies, and agent activity.
A compact map stays on `/overview`; the full experience lives on a new dedicated `/map` page.

## Why

The existing map predates the Marble & Ink migration — it still uses raw `slate-*` dark
colors, a hardcoded near-white dot grid (invisible on light marble), heavy severity rings,
and separate floating cards for every function node. It reads as "defaulted," has hover-only
interaction, and has no folder concept at all.

## Non-goals

- No new graph/visualization dependencies (no react-flow, d3, cytoscape). Hand-rolled SVG
  stays, as everywhere else in the dashboard.
- No new upstream data sources: `codeGraphProvider` topology + the findings/activity
  already fetched by `getSensoriumViewModel` are the only inputs (the view model
  additionally exposes its already-fetched findings list so the sidebar can show
  per-finding rows). `untested`/`dead` still render only when the graph exposes them.
- No minimap (PM ruled it out).
- No changes to how/when the graph is indexed.

## Decisions (PM-selected)

| Decision | Choice |
| --- | --- |
| Layout | **Folder-cluster map** — files grouped inside rounded folder regions |
| Sidebar | All four sections: Health & findings · Structure & contents · Dependencies · Agent activity |
| Navigation | Zoom & pan · Search/jump-to-file · Health filter chips (no minimap) |
| Placement | Compact map on `/overview` + dedicated full-page `/map` with sidebar |

## Architecture

### 1. `@arete/topology`: `layoutClusters` (new, pure)

New exported pure function alongside `layoutTopology`:

```ts
layoutClusters(topology: Topology, opts?: ClusterLayoutOptions): ClusterLayout
```

- Groups **File** nodes by folder derived from `meta.path` (dirname; repo-root files group
  under a `"/"` root region). Folders are single-level in v1 — the immediate parent
  directory, not a nested hierarchy.
- **Function/other child nodes fold into their parent File** (matched by shared `meta.path`)
  — they are not laid out as separate cards; they surface in the sidebar under Contents.
- Sizes a rounded **folder region** around each group; packs file chips inside in a compact
  grid; positions regions with column-flow placement (reusing the existing layout style).
- **Aggregates edges**: file→file edges whose endpoints live in different folders roll up to
  folder→folder edges with a `count`; intra-folder edges are dropped from the at-rest render
  but preserved in the per-file adjacency (for hover/selection reveal and the sidebar).
- Returns: region rects + titles + file-chip positions, aggregated folder edges, per-file
  adjacency (imports / imported-by node ids), and total extent. Deterministic for a given
  topology (unit-testable).

### 2. Dashboard: `buildSidebarModel` (new, pure)

`packages/dashboard/src/lib/code-map-sidebar.ts`:

```ts
buildSidebarModel(topology, sensors, selection: { kind: "file" | "folder"; id: string })
```

Produces the sidebar view model:

- **Health**: open findings for the file (or rolled up across the folder's files): count,
  max severity, per-finding rows (severity, category, body/first line) — from the
  findings list `getSensoriumViewModel` already fetches (newly exposed on the view model;
  the `pain` sensor keeps driving the on-map dots). `buildSidebarModel` takes this list as
  a third input: `buildSidebarModel(topology, sensors, findings, selection)`.
- **Contents**: folder → its files (with per-file finding dots); file → its function/export
  child nodes from the topology.
- **Dependencies**: imports / imported-by lists (node id + label + path), both directions,
  each row carrying the target node id so the map can jump-select it.
- **Activity**: the `activity` sensor (agent name) for the node or any file in the folder.
- Missing data → empty arrays; the component renders honest empty states, never fake data.

### 3. Components

- **`code-map.tsx`** (replaces the render internals of `sensorium-map.tsx`; the
  `SensoriumMap` export name and props `{ topology, sensors }` stay so `/overview` keeps
  working, plus new optional props `interactive?: boolean` and `onNavigate?`):
  - SVG canvas with viewBox-based zoom (wheel) & pan (drag), floating `+ / − / fit`
    control cluster (interactive mode only).
  - Folder regions, file chips, aggregated folder edges at rest; hovering/selecting a file
    reveals its individual curved edges.
  - Search input and filter chips (`All · Findings · Active`) above the canvas
    (interactive mode only): search dims non-matching nodes to ~20% and centers the first
    match; chips filter which nodes render at full opacity.
- **`code-map-sidebar.tsx`**: right slide-over drawer (same pattern as
  `agent-config-drawer.tsx`), rendering the `buildSidebarModel` output in the four
  sections; dependency rows are buttons that jump-select the target node.
- **`/map` page** (`app/(dashboard)/map/page.tsx`): auth + installation scoping exactly
  like `/overview` (`resolveSelectedInstallationIds`; never trust client-supplied
  installation ids), `getSensoriumViewModel`, full-height interactive map + sidebar. Deep
  link `/map?node=<id>` pre-selects and centers that node. Nav entry "Code map" added to
  the sidebar nav.
- **`/overview`**: keeps the compact map (fit-to-width, non-interactive, no sidebar);
  clicking any node navigates to `/map?node=<id>`; an "Open map ↗" affordance links to
  `/map`.

## Visual language (Marble & Ink)

- Folder regions: `surface-1` paper, `border-subtle` hairline, 12px radius, region header
  `○ src/auth` in small-caps `tracking-wide` `content-secondary` with a bronze
  (`accent-secondary`) folder glyph and a muted file count. Hover firms the border
  (`.glass-panel` affordance); selection uses the `glass-panel-active` cobalt ring.
- File chips: `surface-2`, `font-mono` label, small kind glyph; findings render as a small
  glowing severity dot + count (semantic `accent-danger/warning/info`) — not a full ring.
- Edges: ink-toned hairlines (`border-strong`-derived stroke) with slight curve; hover/
  selection edges in cobalt at low opacity. Dot-grid backdrop kept but token-driven
  (`content-primary` at ~4% opacity) so it reads in both themes.
- Accent discipline: cobalt only for selection/hover/active; bronze only for the folder
  glyph; severity colors only for findings. Agent activity = soft cobalt breathing glow
  (framer-motion, `ease-out-expo`), replacing `animate-pulse` on the border.
- Both themes styled via tokens only — no hardcoded slate/white values anywhere.

## Error handling

- Empty topology → existing honest empty panel, restyled to tokens.
- Nodes with missing positions/paths render plain and never crash the map.
- Sidebar for a node with no sensor data shows structure only, with explicit empty states
  ("No open findings", "No recent agent activity").
- `/map?node=<unknown-id>` → map renders unselected (no crash, no error page).

## Testing (TDD)

- `layoutClusters` unit tests: grouping by folder, root-file grouping, function fold-in,
  region sizing contains all chips, cross-folder edge aggregation with counts,
  intra-folder edges preserved in adjacency, deterministic output.
- `buildSidebarModel` unit tests: folder findings rollup (count + max severity), file
  contents (functions), dependency lists both directions, activity, empty cases.
- Component tests (extend `sensorium-map.test.tsx` conventions): click file → sidebar
  opens with correct content; click folder → rollup; dependency row click changes
  selection; filter chips dim correctly; search centers first match; empty topology panel.
- Existing sensorium tests keep passing (export name + base props preserved).

## Where the work lands (governance)

The Sensorium files live on `integration-preview` / `feat/wave2-fix-ui`, not on the
Engineer-1 lane. Build plan per the lane-branch ruling: branch from `integration-preview`,
build there, publish the work on `stroland02/Engineer-1` for the PM to pull into
`integration-preview`. PM should flag Eng2 (dashboard-UI owner) to avoid collisions on
`sensorium-map.tsx` / `overview/page.tsx` while this is in flight.
