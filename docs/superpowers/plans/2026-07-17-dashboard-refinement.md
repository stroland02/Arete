# Dashboard Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the Services "Triage Inbox" and Dashboards reviews table to a Linear/Vercel grade of information design — three signature moments (triage command bar, elevated diff panel, data-table redesign) plus their shared primitives — inside the existing Marble & Ink system.

**Architecture:** Small additive components + pure view-models in `packages/dashboard`. Pure helpers (`deriveTriage`, `diffStat`, `relativeTime`) are unit-tested; components are asserted with `renderToStaticMarkup`. Existing motion lib (`@/lib/motion`) and `count-up-value` are reused, not duplicated.

**Tech Stack:** Next.js 16.2.10 · React 19.2.4 · Tailwind v4 (token-driven, `globals.css`) · framer-motion ^12 (already present) · @tabler/icons-react · vitest (`environment: 'node'`, `renderToStaticMarkup`, no testing-library).

## Global Constraints

- **Anti-fabrication:** every count/severity/status derives from real inputs. Honest zeros (a `0` chip, never hidden to imply activity). Sample/marketing data stays visibly sample. No invented rows.
- **Tokens only** — no hard-coded colors; consume `--color-*` via Tailwind token classes. Both light + dark follow automatically.
- **`prefers-reduced-motion`** honored (use `useReducedMotion` / the existing count-up which already does).
- **`focus-visible`** ring on every interactive element.
- **Lane:** land on `feat/wave2-fix-ui`; push at each checkpoint; PM integrates; **no self-merge**. No edits to `@arete/db` schema, `packages/webhook`, `packages/agents`, `orchestration/src/status.ts`.
- **Suite green:** full `npx vitest run` passes after every task; report the new count.
- Run all commands from `packages/dashboard`.

---

## File Structure

**New:**
- `src/lib/relative-time.ts` — pure `relativeTime(date, now)` (extracted from `activity-list.tsx`'s `timeAgo`, now injectable for tests).
- `src/lib/relative-time.test.ts`
- `src/components/dashboard/services/triage.ts` — `deriveTriage`, `TriageStatus`, `TriageCounts` (pure).
- `src/components/dashboard/services/triage.test.ts`
- `src/components/dashboard/services/triage-bar.tsx` — `TriageBar` presentational component.
- `src/components/dashboard/services/triage-bar.test.tsx`
- `src/components/dashboard/services/diff-stat.ts` — pure `diffStat(rows)` → `{ added, removed }` + `patchText(file, rows)`.
- `src/components/dashboard/services/diff-stat.test.ts`
- `src/components/dashboard/services/diff-view.tsx` — `DiffView` (gutter, +N −M, copy).
- `src/components/dashboard/services/diff-view.test.tsx`
- `src/components/ui/severity-stripe.tsx` — `SeverityStripe` + `severityTone(risk)`.
- `src/components/dashboard/activity-list.test.tsx`

**Modified:**
- `src/components/dashboard/services/services-workspace.tsx` — mount `TriageBar`; swap the inline diff `pre` for `DiffView`.
- `src/components/dashboard/activity-list.tsx` — reuse `relativeTime`; adopt table row layout + `SeverityStripe`.

---

### Task 1: `relativeTime` shared helper

**Files:**
- Create: `src/lib/relative-time.ts`, `src/lib/relative-time.test.ts`
- Modify: `src/components/dashboard/activity-list.tsx` (replace local `timeAgo`)

**Interfaces:**
- Produces: `relativeTime(date: Date, now: Date): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/relative-time.test.ts
import { describe, it, expect } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = new Date("2026-07-17T12:00:00Z");

describe("relativeTime", () => {
  it("under a minute → 'just now'", () => {
    expect(relativeTime(new Date("2026-07-17T11:59:30Z"), NOW)).toBe("just now");
  });
  it("minutes", () => {
    expect(relativeTime(new Date("2026-07-17T11:42:00Z"), NOW)).toBe("18m ago");
  });
  it("hours", () => {
    expect(relativeTime(new Date("2026-07-17T09:00:00Z"), NOW)).toBe("3h ago");
  });
  it("days", () => {
    expect(relativeTime(new Date("2026-07-14T12:00:00Z"), NOW)).toBe("3d ago");
  });
  it("7+ days → locale date", () => {
    const d = new Date("2026-07-01T12:00:00Z");
    expect(relativeTime(d, NOW)).toBe(d.toLocaleDateString());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/relative-time.test.ts`
Expected: FAIL — cannot find module `./relative-time`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/relative-time.ts
/** Compact relative time. `now` is injected so it is pure and testable. */
export function relativeTime(date: Date, now: Date): string {
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
```

- [ ] **Step 4: Point `activity-list.tsx` at the shared helper**

Remove the local `timeAgo` function (activity-list.tsx:17–27). Add import and replace the call:

```tsx
import { relativeTime } from "@/lib/relative-time";
// ...at the call site (was `timeAgo(new Date(review.createdAt))`):
{relativeTime(new Date(review.createdAt), new Date())}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/relative-time.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/relative-time.ts src/lib/relative-time.test.ts src/components/dashboard/activity-list.tsx
git commit -m "refactor(dashboard): extract testable relativeTime helper"
```

---

### Task 2: `deriveTriage` pure view-model

**Files:**
- Create: `src/components/dashboard/services/triage.ts`, `src/components/dashboard/services/triage.test.ts`

**Interfaces:**
- Produces:
  - `type TriageStatus = "awaiting" | "in_flight" | "blocked" | "clear"`
  - `interface TriageCounts { awaiting: number; inFlight: number; blocked: number }`
  - `deriveTriage(items: Array<{ status: TriageStatus }>): TriageCounts`
- Consumed by: Task 3 (`TriageBar`) and the Services workspace, which map their own data (sample `Issue.status`, real `reviewGroups`) to `TriageStatus`. Honesty note: real `ServiceReviewRow` carries no lifecycle field, so real reviews map to `in_flight`; `awaiting`/`blocked` stay `0` until container lifecycle is exposed to this surface.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/dashboard/services/triage.test.ts
import { describe, it, expect } from "vitest";
import { deriveTriage } from "./triage";

describe("deriveTriage", () => {
  it("counts each bucket, ignoring clear", () => {
    expect(
      deriveTriage([
        { status: "awaiting" }, { status: "awaiting" },
        { status: "in_flight" }, { status: "blocked" }, { status: "clear" },
      ])
    ).toEqual({ awaiting: 2, inFlight: 1, blocked: 1 });
  });
  it("empty → all zero (honest)", () => {
    expect(deriveTriage([])).toEqual({ awaiting: 0, inFlight: 0, blocked: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/services/triage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/dashboard/services/triage.ts
export type TriageStatus = "awaiting" | "in_flight" | "blocked" | "clear";
export interface TriageCounts { awaiting: number; inFlight: number; blocked: number }

/** Pure tally of what needs the human. `clear` items contribute to none. */
export function deriveTriage(items: Array<{ status: TriageStatus }>): TriageCounts {
  const counts: TriageCounts = { awaiting: 0, inFlight: 0, blocked: 0 };
  for (const { status } of items) {
    if (status === "awaiting") counts.awaiting++;
    else if (status === "in_flight") counts.inFlight++;
    else if (status === "blocked") counts.blocked++;
  }
  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/services/triage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/services/triage.ts src/components/dashboard/services/triage.test.ts
git commit -m "feat(services): deriveTriage view-model for the triage command bar"
```

---

### Task 3: `TriageBar` + mount in Services workspace

**Files:**
- Create: `src/components/dashboard/services/triage-bar.tsx`, `src/components/dashboard/services/triage-bar.test.tsx`
- Modify: `src/components/dashboard/services/services-workspace.tsx`

**Interfaces:**
- Consumes: `TriageCounts` (Task 2), `CountUpValue` (`@/components/dashboard/count-up-value`).
- Produces: `TriageBar({ counts }: { counts: TriageCounts })`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/services/triage-bar.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TriageBar } from "./triage-bar";

describe("TriageBar", () => {
  it("labels the three buckets", () => {
    const html = renderToStaticMarkup(
      <TriageBar counts={{ awaiting: 2, inFlight: 3, blocked: 1 }} />
    );
    expect(html).toContain("Awaiting approval");
    expect(html).toContain("In flight");
    expect(html).toContain("Blocked");
  });
  it("renders honest zeros (does not hide empty buckets)", () => {
    const html = renderToStaticMarkup(
      <TriageBar counts={{ awaiting: 0, inFlight: 0, blocked: 0 }} />
    );
    expect(html).toContain("Awaiting approval");
    expect(html).toMatch(/nothing waiting on you/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/services/triage-bar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/dashboard/services/triage-bar.tsx
"use client";

import { CountUpValue } from "@/components/dashboard/count-up-value";
import type { TriageCounts } from "./triage";

interface Chip { label: string; value: number; dot: string; text: string }

/**
 * The Services "what needs you now?" strip. Three glanceable buckets over the
 * REAL triage counts. Honest: zeros are shown (never hidden to imply activity);
 * an all-clear bar says so plainly rather than vanishing.
 */
export function TriageBar({ counts }: { counts: TriageCounts }) {
  const chips: Chip[] = [
    { label: "Awaiting approval", value: counts.awaiting, dot: "bg-accent-primary", text: "text-accent-primary" },
    { label: "In flight", value: counts.inFlight, dot: "bg-accent-info", text: "text-accent-info" },
    { label: "Blocked", value: counts.blocked, dot: "bg-accent-warning", text: "text-accent-warning" },
  ];
  const allClear = counts.awaiting + counts.inFlight + counts.blocked === 0;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2"
      aria-label="Triage summary"
    >
      <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-content-muted">Triage</span>
      {chips.map((c) => (
        <span
          key={c.label}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-2/60 px-2.5 py-1"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden />
          <span className={`font-mono text-[12px] font-semibold tabular-nums ${c.value === 0 ? "text-content-muted" : c.text}`}>
            <CountUpValue value={String(c.value)} />
          </span>
          <span className="text-[11px] text-content-secondary">{c.label}</span>
        </span>
      ))}
      {allClear && (
        <span className="ml-auto text-[11px] text-content-muted">Nothing waiting on you.</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/services/triage-bar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount in the workspace**

In `services-workspace.tsx`: add imports

```tsx
import { TriageBar } from "./triage-bar";
import { deriveTriage, type TriageStatus } from "./triage";
```

Inside `ServicesWorkspace`, compute counts from whichever mode is active (honest mapping):

```tsx
// Sample Issue.status → TriageStatus (marketing preview only).
const sampleStatus = (s: string): TriageStatus =>
  s === "Fix proposed" ? "awaiting" : s === "Agent fixing" || s === "Triaging" ? "in_flight" : "clear";
const triageCounts = realMode
  // Real reviews carry no lifecycle field yet → each open review is in-flight;
  // awaiting/blocked stay 0 until container state reaches this surface.
  ? deriveTriage((reviewGroups ?? []).flatMap((g) => g.reviews).map(() => ({ status: "in_flight" as TriageStatus })))
  : deriveTriage(issues.map((i) => ({ status: sampleStatus(i.status) })));
```

Wrap the three-pane grid so the bar sits above it. Change the outer `return` structure from a single grid `<div>` to a column that stacks `TriageBar` over the existing grid:

```tsx
return (
  <div ref={containerRef} className="flex min-h-0 flex-col">
    <TriageBar counts={triageCounts} />
    <div className={outerClass}>
      {/* ...existing three <section> panes unchanged... */}
    </div>
  </div>
);
```

Keep `outerClass` as-is; the `-m-8`/height math still applies to the inner grid. Verify the embedded variant still fills height (the outer flex column is `min-h-0`).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, exit 0. Note the new total.

- [ ] **Step 7: Commit + checkpoint push**

```bash
git add src/components/dashboard/services/triage-bar.tsx src/components/dashboard/services/triage-bar.test.tsx src/components/dashboard/services/services-workspace.tsx
git commit -m "feat(services): triage command bar over the inbox (signature 1)"
git push origin feat/wave2-fix-ui
```

---

### Task 4: `SeverityStripe` shared primitive

**Files:**
- Create: `src/components/ui/severity-stripe.tsx`

**Interfaces:**
- Produces:
  - `severityTone(risk: string): "danger" | "warning" | "info" | "success"`
  - `SeverityStripe({ risk }: { risk: string })` — a 2px left bar in the semantic tone.
- Consumed by: Task 5 (data table). Asserted through Task 5's test (no trivial standalone test file).

- [ ] **Step 1: Write the implementation**

```tsx
// src/components/ui/severity-stripe.tsx
const TONE_BG: Record<string, string> = {
  danger: "bg-accent-danger",
  warning: "bg-accent-warning",
  info: "bg-accent-info",
  success: "bg-accent-success",
};

/** Maps a risk word to a semantic tone (kept separate from the brand accent). */
export function severityTone(risk: string): "danger" | "warning" | "info" | "success" {
  switch (risk.toLowerCase()) {
    case "critical":
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
      return "success";
    default:
      return "info";
  }
}

/** A 2px severity bar for the leading edge of a table row / card. */
export function SeverityStripe({ risk }: { risk: string }) {
  return <span className={`w-0.5 shrink-0 self-stretch rounded-full ${TONE_BG[severityTone(risk)]}`} aria-hidden />;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/severity-stripe.tsx
git commit -m "feat(ui): SeverityStripe + severityTone shared primitive"
```

---

### Task 5: Data-table redesign of `ActivityList`

**Files:**
- Modify: `src/components/dashboard/activity-list.tsx`
- Create: `src/components/dashboard/activity-list.test.tsx`

**Interfaces:**
- `ActivityItem` contract is UNCHANGED (`id, repositoryName, prNumber, createdAt, riskLevel`) so `TableWidget` and every caller keep working.
- Consumes: `SeverityStripe`, `severityTone` (Task 4), `relativeTime` (Task 1).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/activity-list.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityList } from "./activity-list";

const rows = [
  { id: "r1", repositoryName: "acme/api", prNumber: 418, createdAt: new Date().toISOString(), riskLevel: "high" },
];

describe("ActivityList (table)", () => {
  it("renders repo, PR number, and risk", () => {
    const html = renderToStaticMarkup(<ActivityList reviews={rows} />);
    expect(html).toContain("acme/api");
    expect(html).toContain("PR #418");
    expect(html).toMatch(/high/i);
  });
  it("empty → honest empty state, no fabricated rows", () => {
    const html = renderToStaticMarkup(<ActivityList reviews={[]} />);
    expect(html).toMatch(/no reviews yet/i);
    expect(html).not.toContain("PR #");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/activity-list.test.tsx`
Expected: FAIL (assertion on the new `PR #` layout) before the rewrite.

- [ ] **Step 3: Rewrite the list as a dense table**

Replace the body of `ActivityList` (keep the `"use client"`, the `EmptyState` branch, and the `ActivityItem` interface). New row layout: leading `SeverityStripe`, mono repo, mono `PR #n`, right-aligned `relativeTime`, and the existing risk pill. Reuse `staggerContainer`/`fadeSlideUp` from `@/lib/motion`.

```tsx
"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { IconGitPullRequest } from "@tabler/icons-react";
import { staggerContainer, fadeSlideUp } from "@/lib/motion";
import { EmptyState } from "./empty-state";
import { relativeTime } from "@/lib/relative-time";
import { SeverityStripe } from "@/components/ui/severity-stripe";

export interface ActivityItem {
  id: string;
  repositoryName: string;
  prNumber: number;
  createdAt: string;
  riskLevel: string;
}

function riskBadgeClasses(riskLevel: string): string {
  switch (riskLevel.toLowerCase()) {
    case "critical":
    case "high":
      return "bg-accent-danger/10 text-accent-danger border-accent-danger/25";
    case "medium":
      return "bg-accent-warning/10 text-accent-warning border-accent-warning/25";
    case "low":
      return "bg-accent-success/10 text-accent-success border-accent-success/25";
    default:
      return "bg-content-primary/5 text-content-muted border-border-default";
  }
}

export function ActivityList({ reviews }: { reviews: ActivityItem[] }) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={<IconGitPullRequest className="w-6 h-6" />}
        title="No reviews yet"
        description="Reviews will appear here as pull requests are analyzed."
      />
    );
  }

  return (
    <motion.div className="flex flex-col" variants={staggerContainer} initial="hidden" animate="show">
      {reviews.map((review) => (
        <motion.div key={review.id} variants={fadeSlideUp}>
          <Link
            href={`/reviews/${review.id}`}
            className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-content-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
          >
            <SeverityStripe risk={review.riskLevel} />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-content-primary">{review.repositoryName}</span>
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-content-muted">PR #{review.prNumber}</span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${riskBadgeClasses(review.riskLevel)}`}
            >
              {review.riskLevel}
            </span>
            <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-content-muted">
              {relativeTime(new Date(review.createdAt), new Date())}
            </span>
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
```

- [ ] **Step 4: Run test + full suite + typecheck**

Run: `npx vitest run src/components/dashboard/activity-list.test.tsx && npx vitest run && npx tsc --noEmit`
Expected: PASS, exit 0. Note the new total.

- [ ] **Step 5: Commit + checkpoint push**

```bash
git add src/components/dashboard/activity-list.tsx src/components/dashboard/activity-list.test.tsx
git commit -m "feat(dashboard): Linear-grade reviews table (signature 3)"
git push origin feat/wave2-fix-ui
```

---

### Task 6: `diffStat` + `patchText` pure helpers

**Files:**
- Create: `src/components/dashboard/services/diff-stat.ts`, `src/components/dashboard/services/diff-stat.test.ts`

**Interfaces:**
- Consumes: `DiffRow` (`{ kind: "context" | "add" | "remove"; text: string }`, exported from `services-workspace.tsx`).
- Produces:
  - `diffStat(rows: DiffRow[]): { added: number; removed: number }`
  - `patchText(file: string, rows: DiffRow[]): string` — a copyable unified-ish patch body.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/dashboard/services/diff-stat.test.ts
import { describe, it, expect } from "vitest";
import { diffStat, patchText } from "./diff-stat";
import type { DiffRow } from "./services-workspace";

const rows: DiffRow[] = [
  { kind: "context", text: "function f() {" },
  { kind: "remove", text: "  return 1" },
  { kind: "add", text: "  return 2" },
  { kind: "add", text: "  // note" },
];

describe("diffStat", () => {
  it("counts adds and removes", () => {
    expect(diffStat(rows)).toEqual({ added: 2, removed: 1 });
  });
});
describe("patchText", () => {
  it("prefixes +/-/space and heads with the file", () => {
    expect(patchText("a.ts", rows)).toBe(
      "--- a.ts\n function f() {\n-  return 1\n+  return 2\n+  // note"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/services/diff-stat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/dashboard/services/diff-stat.ts
import type { DiffRow } from "./services-workspace";

export function diffStat(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const r of rows) {
    if (r.kind === "add") added++;
    else if (r.kind === "remove") removed++;
  }
  return { added, removed };
}

const SIGIL: Record<DiffRow["kind"], string> = { add: "+", remove: "-", context: " " };

/** Reconstruct a copyable patch body. Header line names the file. */
export function patchText(file: string, rows: DiffRow[]): string {
  return [`--- ${file}`, ...rows.map((r) => `${SIGIL[r.kind]}${r.text}`)].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/services/diff-stat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/services/diff-stat.ts src/components/dashboard/services/diff-stat.test.ts
git commit -m "feat(services): diffStat + patchText helpers for the diff panel"
```

---

### Task 7: `DiffView` + swap into `IssuePanel`

**Files:**
- Create: `src/components/dashboard/services/diff-view.tsx`, `src/components/dashboard/services/diff-view.test.tsx`
- Modify: `src/components/dashboard/services/services-workspace.tsx` (replace the inline diff `pre`, ~875–890)

**Interfaces:**
- Consumes: `DiffRow` (from `services-workspace`), `diffStat`, `patchText` (Task 6).
- Produces: `DiffView({ file, rows }: { file: string; rows: DiffRow[] })`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/services/diff-view.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffView } from "./diff-view";
import type { DiffRow } from "./services-workspace";

const rows: DiffRow[] = [
  { kind: "context", text: "function f() {" },
  { kind: "remove", text: "  return 1" },
  { kind: "add", text: "  return 2" },
];

describe("DiffView", () => {
  it("shows the file header and +N −M summary", () => {
    const html = renderToStaticMarkup(<DiffView file="src/a.ts" rows={rows} />);
    expect(html).toContain("src/a.ts");
    expect(html).toContain("+1");
    expect(html).toMatch(/[−-]1/); // − (minus) or - (hyphen)
  });
  it("renders a line-number gutter", () => {
    const html = renderToStaticMarkup(<DiffView file="a.ts" rows={rows} />);
    expect(html).toContain("aria-hidden"); // gutter cells are decorative
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/services/diff-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/dashboard/services/diff-view.tsx
"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import type { DiffRow } from "./services-workspace";
import { diffStat, patchText } from "./diff-stat";

const ROW_BG: Record<DiffRow["kind"], string> = {
  add: "bg-accent-success/10",
  remove: "bg-accent-danger/10",
  context: "",
};
const SIGIL_CLASS: Record<DiffRow["kind"], string> = {
  add: "text-accent-success",
  remove: "text-accent-danger",
  context: "text-content-muted/50",
};

/**
 * A real code-review diff surface: file header + change summary, a muted
 * line-number gutter, tinted add/remove rows, and a copy-patch affordance.
 * Purely presentational over the provided rows — never fabricates content.
 */
export function DiffView({ file, rows }: { file: string; rows: DiffRow[] }) {
  const { added, removed } = diffStat(rows);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(patchText(file, rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — leave the affordance unlatched, no false success */
    }
  }

  // Gutter line numbers advance on context/add (target-side); removes show a dot.
  let lineNo = 0;

  return (
    <div className="overflow-hidden rounded-lg border border-border-default bg-surface-2">
      <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-content-muted">{file}</span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-accent-success">+{added}</span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-accent-danger">−{removed}</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy patch"
          className="shrink-0 rounded p-0.5 text-content-muted transition-colors hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
        >
          {copied ? <IconCheck size={13} stroke={2} className="text-accent-success" /> : <IconCopy size={13} stroke={1.75} />}
        </button>
      </div>
      <pre className="overflow-x-auto py-1 font-mono text-[11px] leading-relaxed">
        {rows.map((r, idx) => {
          const n = r.kind === "remove" ? "" : String(++lineNo);
          return (
            <div key={idx} className={`flex gap-2 px-2 ${ROW_BG[r.kind]}`}>
              <span className="w-6 shrink-0 select-none text-right text-content-muted/40 tabular-nums" aria-hidden>{n}</span>
              <span className={`shrink-0 select-none ${SIGIL_CLASS[r.kind]}`} aria-hidden>
                {r.kind === "add" ? "+" : r.kind === "remove" ? "-" : " "}
              </span>
              <span className={r.kind === "context" ? "text-content-muted" : "text-content-secondary"}>{r.text}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: Swap into `IssuePanel`**

In `services-workspace.tsx`, add `import { DiffView } from "./diff-view";`. Replace the inline review-comment diff block (the `<div className="overflow-hidden rounded-lg border ...">…</pre></div>`, ~875–890) with:

```tsx
<DiffView file={issue.fix.file} rows={issue.fix.rows} />
```

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, exit 0. Note the new total.

- [ ] **Step 6: Commit + checkpoint push**

```bash
git add src/components/dashboard/services/diff-view.tsx src/components/dashboard/services/diff-view.test.tsx src/components/dashboard/services/services-workspace.tsx
git commit -m "feat(services): elevated diff/patch panel (signature 2)"
git push origin feat/wave2-fix-ui
```

---

### Task 8: Rail focus-visible polish (supporting)

**Files:**
- Modify: `src/components/dashboard/services/services-workspace.tsx`

- [ ] **Step 1: Add `focus-visible` rings to rail row buttons**

For each rail `<button>` (the repo/service toggles and the issue/PR rows), append to the `className`:

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-primary/40
```

Do not change layout or behavior. (The active-row accent stripe and hover states stay.)

- [ ] **Step 2: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 3: Commit + checkpoint push**

```bash
git add src/components/dashboard/services/services-workspace.tsx
git commit -m "polish(services): keyboard focus rings on the triage rail"
git push origin feat/wave2-fix-ui
```

---

## Self-Review

- **Spec coverage:** A1 triage bar → Tasks 2–3; A2 diff panel → Tasks 6–7; A3 rail polish → Task 8; B1 data table → Tasks 1,4,5; shared primitives (`SeverityStripe`, `DiffView`, `TriageBar`+`deriveTriage`) → Tasks 2,3,4,6,7. Supporting B2/B3/B4 (stat cards, timeseries, controls) are intentionally deferred to a follow-up plan (noted to the user).
- **Type consistency:** `TriageCounts`/`TriageStatus` defined in Task 2, consumed unchanged in Task 3. `DiffRow` reused from `services-workspace` across Tasks 6–7. `ActivityItem` contract unchanged in Task 5. `severityTone` return union stable across Tasks 4–5.
- **Placeholder scan:** every code step carries complete code; no TBDs.
- **Honesty:** triage zeros shown; real-mode lifecycle gap documented (maps to in_flight, no fabricated awaiting/blocked); diff/table purely reflect inputs; empty states preserved and asserted.
