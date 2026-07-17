# Orchestration Phase A — Work-Floor Substrate Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@arete/orchestration` (additively) to express the Kuma work floor — a PM-distributor dispatch plan, a specialist roster, the QA validation loop, and a pure Envelope→transcript projection — as pure model + functions, so Phase B's Python `LangGraphDriver` and Phase C's dashboard surfacing conform to a frozen TS contract.

**Architecture:** Five small additive modules in `packages/orchestration/src`, each a pure TypeScript type-set + function, mirroring the v1 style (node:test + `tsx --test`, `.js` import extensions, barrel export). No new runtime deps, no IO. Reuses the existing `TaskEntry`/`Lane`/`detectLaneConflicts`/`claimable` ledger, the `transition()` status machine, and the `Envelope`/`route()` message contract verbatim.

**Tech Stack:** TypeScript (nodenext), node:test via `tsx --test src/*.test.ts`, tsc build to `dist/` (gitignored).

## Global Constraints

- **Lane:** `packages/orchestration/**` only. Do NOT touch `packages/agents`, `packages/dashboard`, or `server.py`.
- **Additive only:** no breaking changes to existing v1 exports; existing 25 tests must stay green.
- **Design source of truth:** `docs/superpowers/specs/2026-07-15-kuma-work-floor-orchestration-design.md`.
- **PM rulings frozen into the contract:** Q1 Python `LangGraphDriver` conforms to this TS contract (canonical); Q3 `maxPasses` default = `3`; Q4 coexist (this path is for problem/healing containers); the driver/agents/dashboard are deferred seams (not built here).
- **Style:** `.js` import extensions; pure functions only; no `Date.now()`/`Math.random()` in the model.
- **Verify each module:** `pnpm --filter @arete/orchestration test` and `... typecheck` stay green.

---

### Task 1: Specialty roster (`specialty.ts`)

**Files:**
- Create: `packages/orchestration/src/specialty.ts`
- Test: `packages/orchestration/src/specialty.test.ts`
- Modify: `packages/orchestration/src/index.ts` (add barrel export)

**Interfaces:**
- Produces: `type Specialty`; `const SPECIALTIES: readonly Specialty[]`.

- [ ] **Step 1: Write the failing test**

```ts
// specialty.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SPECIALTIES, type Specialty } from "./specialty.js";

test("SPECIALTIES lists the seven work-floor disciplines, unique", () => {
  assert.equal(SPECIALTIES.length, 7);
  assert.equal(new Set(SPECIALTIES).size, 7);
  const expected: Specialty[] = [
    "reproduction", "root-cause", "fix-author",
    "test-author", "security", "reviewer", "qa",
  ];
  for (const s of expected) assert.ok(SPECIALTIES.includes(s), `missing ${s}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/strol/orca/workspaces/Arete/Engineer-2/packages/orchestration && npx tsx --test src/specialty.test.ts`
Expected: FAIL (cannot find module `./specialty.js`).

- [ ] **Step 3: Write minimal implementation**

```ts
// specialty.ts
// The specialist disciplines the PM-distributor dispatches to. A discipline is a
// *worker* specialization (roles.ts is unchanged) — the review disciplines
// (security/reviewer) reuse today's agents; reproduction/root-cause/fix-author/
// test-author/qa are net-new (design §2.2).
export type Specialty =
  | "reproduction"
  | "root-cause"
  | "fix-author"
  | "test-author"
  | "security"
  | "reviewer"
  | "qa";

export const SPECIALTIES: readonly Specialty[] = [
  "reproduction",
  "root-cause",
  "fix-author",
  "test-author",
  "security",
  "reviewer",
  "qa",
];
```

- [ ] **Step 4: Add barrel export**

In `index.ts`, add after the existing exports: `export * from "./specialty.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/specialty.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestration/src/specialty.ts packages/orchestration/src/specialty.test.ts packages/orchestration/src/index.ts
git commit -m "feat(orchestration): specialist roster (Specialty)"
```

---

### Task 2: Message kinds + specialty tag (`messages.ts` additive)

**Files:**
- Modify: `packages/orchestration/src/messages.ts` (extend `MessageKind`; add optional `specialty` to `Envelope`)
- Test: `packages/orchestration/src/messages.test.ts` (append cases)

**Interfaces:**
- Consumes: `Specialty` (Task 1).
- Produces: `MessageKind` now includes `"handoff" | "qa-result"`; `Envelope.specialty?: Specialty`. `route()` unchanged.

- [ ] **Step 1: Write the failing test (append to messages.test.ts)**

```ts
import { SPECIALTIES } from "./specialty.js";

test("handoff and qa-result are routable message kinds carrying a specialty", () => {
  const env = {
    id: "e1", traceId: "t1",
    from: { role: "orchestrator", id: "pm" } as const,
    to: { role: "worker", id: "w1" } as const,
    kind: "handoff" as const,
    specialty: "fix-author" as const,
    body: "author the fix",
  };
  assert.ok(SPECIALTIES.includes(env.specialty));
  assert.equal(route(env).ok, true);

  const qa = { ...env, id: "e2", kind: "qa-result" as const, specialty: "qa" as const,
    from: { role: "worker", id: "qa" } as const, to: { role: "orchestrator", id: "pm" } as const };
  assert.equal(route(qa).ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/messages.test.ts`
Expected: FAIL (TS type error — `"handoff"`/`"qa-result"` not assignable to `MessageKind`, and `specialty` not on `Envelope`).

- [ ] **Step 3: Write minimal implementation**

In `messages.ts`, add the import at the top with the other type imports:

```ts
import type { Specialty } from "./specialty.js";
```

Replace the `MessageKind` union with:

```ts
export type MessageKind =
  | "dispatch"
  | "status"
  | "blocker"
  | "gate-request"
  | "gate-result"
  | "handoff"
  | "qa-result";
```

Add the optional field to `Envelope` (after `laneClaims?`):

```ts
  /** the sender's discipline, when it is a specialist worker (design §3.1) */
  specialty?: Specialty;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/messages.test.ts`
Expected: PASS (existing route() cases + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/orchestration/src/messages.ts packages/orchestration/src/messages.test.ts
git commit -m "feat(orchestration): handoff/qa-result message kinds + specialty tag"
```

---

### Task 3: Dispatch plan → tasks (`dispatch.ts`)

**Files:**
- Create: `packages/orchestration/src/dispatch.ts`
- Test: `packages/orchestration/src/dispatch.test.ts`
- Modify: `packages/orchestration/src/index.ts` (barrel export)

**Interfaces:**
- Consumes: `Specialty` (Task 1); `Lane`, `TaskEntry` (ledger.ts).
- Produces: `interface Assignment`, `interface DispatchPlan`, `function planToTasks(plan: DispatchPlan): TaskEntry[]`.

- [ ] **Step 1: Write the failing test**

```ts
// dispatch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planToTasks, type DispatchPlan } from "./dispatch.js";
import { detectLaneConflicts, claimable } from "./ledger.js";

const plan: DispatchPlan = {
  problemId: "ERR-42",
  analysis: "null deref in checkout",
  assignments: [
    { specialty: "root-cause", taskId: "rc", title: "localize", owner: "a",
      dependsOn: [], lane: { packages: ["packages/web"], globs: [] } },
    { specialty: "fix-author", taskId: "fix", title: "author fix", owner: "b",
      dependsOn: ["rc"], lane: { packages: ["packages/web"], globs: [] } },
  ],
};

test("planToTasks maps assignments to ready TaskEntries preserving deps + lane", () => {
  const tasks = planToTasks(plan);
  assert.equal(tasks.length, 2);
  const fix = tasks.find((t) => t.id === "fix")!;
  assert.equal(fix.state, "ready");
  assert.equal(fix.phase, null);
  assert.deepEqual(fix.dependsOn, ["rc"]);
  assert.deepEqual(fix.lane.packages, ["packages/web"]);
});

test("planToTasks output feeds lane-conflict detection + claimable gating", () => {
  const tasks = planToTasks(plan).map((t) =>
    t.id === "rc" ? { ...t, state: "running" as const } : t);
  // fix depends on rc (not merged) -> not claimable yet
  assert.equal(claimable(tasks, "fix"), false);
  // two active tasks share packages/web -> conflict surfaced
  const running = tasks.map((t) => ({ ...t, state: "running" as const }));
  assert.equal(detectLaneConflicts(running).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/dispatch.test.ts`
Expected: FAIL (cannot find module `./dispatch.js`).

- [ ] **Step 3: Write minimal implementation**

```ts
// dispatch.ts
// The PM-distributor's output: an initial analysis + typed assignments. Each
// assignment becomes a `ready` TaskEntry in the existing ledger, so lane-conflict
// detection and claimable() apply unchanged (design §2.3).
import type { Lane, TaskEntry } from "./ledger.js";
import type { Specialty } from "./specialty.js";

export interface Assignment {
  specialty: Specialty;
  taskId: string;
  title: string;
  owner: string; // worker id
  dependsOn: string[]; // task ids
  lane: Lane;
}

export interface DispatchPlan {
  problemId: string;
  analysis: string;
  assignments: Assignment[];
}

export function planToTasks(plan: DispatchPlan): TaskEntry[] {
  return plan.assignments.map((a) => ({
    id: a.taskId,
    title: a.title,
    owner: a.owner,
    lane: a.lane,
    state: "ready",
    phase: null,
    dependsOn: a.dependsOn,
  }));
}
```

- [ ] **Step 4: Add barrel export**

In `index.ts`: `export * from "./dispatch.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/dispatch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestration/src/dispatch.ts packages/orchestration/src/dispatch.test.ts packages/orchestration/src/index.ts
git commit -m "feat(orchestration): DispatchPlan + planToTasks"
```

---

### Task 4: QA validation loop (`qa.ts`)

**Files:**
- Create: `packages/orchestration/src/qa.ts`
- Test: `packages/orchestration/src/qa.test.ts`
- Modify: `packages/orchestration/src/index.ts` (barrel export)

**Interfaces:**
- Consumes: `Verification`, `transition` (status.ts).
- Produces: `const DEFAULT_MAX_PASSES = 3`; `interface QaResult`; `interface QaLoopState`; `type QaOutcome`; `function advanceQaLoop(state, result): { state: QaLoopState; outcome: QaOutcome }`; `function qaVerification(evidence: string): Verification`.

- [ ] **Step 1: Write the failing test**

```ts
// qa.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceQaLoop, qaVerification, DEFAULT_MAX_PASSES, type QaLoopState } from "./qa.js";
import { transition } from "./status.js";

const fresh = (): QaLoopState => ({ passes: 0, maxPasses: DEFAULT_MAX_PASSES });

test("QA pass routes to synthesize and yields done-eligible verification", () => {
  const { outcome } = advanceQaLoop(fresh(), { pass: true });
  assert.equal(outcome.action, "synthesize");
  const r = transition("progress", { phase: "done", note: "qa green", verification: qaVerification("drove checkout") });
  assert.equal(r.ok, true);
});

test("QA fail under the cap re-dispatches with the exact error", () => {
  const { state, outcome } = advanceQaLoop(fresh(), { pass: false, error: "500 on submit" });
  assert.equal(state.passes, 1);
  assert.equal(outcome.action, "redispatch");
  assert.equal(outcome.action === "redispatch" && outcome.error, "500 on submit");
});

test("QA fail at the cap escalates to the human gate, never loops", () => {
  const state = { passes: DEFAULT_MAX_PASSES - 1, maxPasses: DEFAULT_MAX_PASSES };
  const { state: next, outcome } = advanceQaLoop(state, { pass: false, error: "still broken" });
  assert.equal(next.passes, DEFAULT_MAX_PASSES);
  assert.equal(outcome.action, "escalate-human");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/qa.test.ts`
Expected: FAIL (cannot find module `./qa.js`).

- [ ] **Step 3: Write minimal implementation**

```ts
// qa.ts
// The QA/UI-validation loop (design §2.5). After a candidate fix, QA drives the
// affected flow and returns pass/fail. Pass -> synthesize. Fail -> re-dispatch
// with the exact error, bounded by maxPasses; on exhaustion escalate to the human
// gate rather than loop (kills the MAST no-termination failure mode). Pure loop
// control — the caller owns the actual dispatch/harness (Phase B).
import type { Verification } from "./status.js";

export const DEFAULT_MAX_PASSES = 3;

export interface QaResult {
  pass: boolean;
  error?: string; // required-in-spirit when pass === false
}

export interface QaLoopState {
  passes: number; // fix attempts QA has already evaluated
  maxPasses: number;
}

export type QaOutcome =
  | { action: "synthesize" }
  | { action: "redispatch"; error: string }
  | { action: "escalate-human"; reason: string };

export function advanceQaLoop(
  state: QaLoopState,
  result: QaResult,
): { state: QaLoopState; outcome: QaOutcome } {
  if (result.pass) {
    return { state, outcome: { action: "synthesize" } };
  }
  const passes = state.passes + 1;
  const next = { ...state, passes };
  const error = result.error ?? "QA reported a failure without detail";
  if (passes >= state.maxPasses) {
    return {
      state: next,
      outcome: {
        action: "escalate-human",
        reason: `QA still failing after ${passes} pass(es): ${error}`,
      },
    };
  }
  return { state: next, outcome: { action: "redispatch", error } };
}

/** A QA pass IS the "drove the real flow" evidence the status machine's `done`
 *  gate requires; to reach QA the review/test specialists already ran, so the
 *  matrix is green as well (design §2.5, §7). */
export function qaVerification(evidence: string): Verification {
  return { matrix: true, droveRealFlow: true, evidence };
}
```

- [ ] **Step 4: Add barrel export**

In `index.ts`: `export * from "./qa.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/qa.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestration/src/qa.ts packages/orchestration/src/qa.test.ts packages/orchestration/src/index.ts
git commit -m "feat(orchestration): QA validation loop with maxPasses guard"
```

---

### Task 5: Envelope → transcript projection (`transcript.ts`)

**Files:**
- Create: `packages/orchestration/src/transcript.ts`
- Test: `packages/orchestration/src/transcript.test.ts`
- Modify: `packages/orchestration/src/index.ts` (barrel export)

**Interfaces:**
- Consumes: `Envelope`, `MessageKind` (messages.ts); `Specialty` (Task 1).
- Produces: `type TranscriptKind`; `interface TranscriptEvent`; `function toTranscriptEvent(env: Envelope): TranscriptEvent` (total over `MessageKind`).

- [ ] **Step 1: Write the failing test**

```ts
// transcript.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toTranscriptEvent } from "./transcript.js";
import type { Envelope, MessageKind } from "./messages.js";

const base = (kind: MessageKind): Envelope => ({
  id: "e", traceId: "t",
  from: { role: "worker", id: "w1" },
  to: { role: "orchestrator", id: "pm" },
  kind,
  specialty: "fix-author",
  body: "hello",
});

test("projection carries provenance, specialty, and body", () => {
  const ev = toTranscriptEvent(base("status"));
  assert.equal(ev.kind, "report");
  assert.equal(ev.specialty, "fix-author");
  assert.equal(ev.from, "w1");
  assert.equal(ev.to, "pm");
  assert.equal(ev.text, "hello");
});

test("toTranscriptEvent is total over every MessageKind", () => {
  const kinds: MessageKind[] = ["dispatch", "status", "blocker", "gate-request", "gate-result", "handoff", "qa-result"];
  const map = Object.fromEntries(kinds.map((k) => [k, toTranscriptEvent(base(k)).kind]));
  assert.deepEqual(map, {
    dispatch: "dispatch",
    handoff: "dispatch",
    status: "report",
    blocker: "report",
    "gate-request": "verify",
    "gate-result": "verify",
    "qa-result": "qa",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/transcript.test.ts`
Expected: FAIL (cannot find module `./transcript.js`).

- [ ] **Step 3: Write minimal implementation**

```ts
// transcript.ts
// Pure projection: an inter-agent Envelope -> a transcript event shaped to the
// dashboard's existing SynthStep vocabulary (design §3.1). The dashboard consumes
// this over the EXISTING init->step*->done SSE stream; no second stream. Timestamps
// are the emitter's concern (kept out of this pure, deterministic mapping).
import type { Envelope, MessageKind } from "./messages.js";
import type { Specialty } from "./specialty.js";

export type TranscriptKind = "dispatch" | "report" | "verify" | "qa";

export interface TranscriptEvent {
  kind: TranscriptKind;
  from: string;
  to: string;
  specialty?: Specialty;
  text: string;
}

const KIND: Record<MessageKind, TranscriptKind> = {
  dispatch: "dispatch",
  handoff: "dispatch",
  status: "report",
  blocker: "report",
  "gate-request": "verify",
  "gate-result": "verify",
  "qa-result": "qa",
};

export function toTranscriptEvent(env: Envelope): TranscriptEvent {
  return {
    kind: KIND[env.kind],
    from: env.from.id,
    to: env.to.id,
    specialty: env.specialty,
    text: env.body,
  };
}
```

- [ ] **Step 4: Add barrel export**

In `index.ts`: `export * from "./transcript.js";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/transcript.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestration/src/transcript.ts packages/orchestration/src/transcript.test.ts packages/orchestration/src/index.ts
git commit -m "feat(orchestration): Envelope->transcript projection"
```

---

### Task 6: Finalize — README + full green matrix + composed drive

**Files:**
- Modify: `packages/orchestration/README.md` (add the four new modules to the table + note the frozen Phase-B/C seam)

**Interfaces:** none (documentation + verification only).

- [ ] **Step 1: Update README module table**

Add rows for `specialty`, `dispatch`, `qa`, `transcript`, and a one-line note that the Python `LangGraphDriver` (Phase B) and dashboard surfacing (Phase C) conform to these frozen contracts.

- [ ] **Step 2: Run the full matrix**

Run: `pnpm --filter @arete/orchestration test && pnpm --filter @arete/orchestration typecheck && pnpm --filter @arete/orchestration build`
Expected: all tests pass (25 existing + the new ones), typecheck clean, build emits `dist/`.

- [ ] **Step 3: Drive the composed work-floor flow**

Extend the scratchpad drive script to: build a `DispatchPlan` → `planToTasks` → `detectLaneConflicts`/`claimable` → run a QA fail→redispatch→pass loop via `advanceQaLoop` → project a few envelopes via `toTranscriptEvent`. Import from the built `dist/index.js`. Confirm it prints a clean end-to-end trace.

- [ ] **Step 4: Commit**

```bash
git add packages/orchestration/README.md
git commit -m "docs(orchestration): Phase A modules in README + frozen seam note"
```

---

## Self-Review

**Spec coverage:** design §2.2 roster → Task 1; §2.4 message kinds + §3.1 specialty tag → Task 2; §2.3 DispatchPlan/planToTasks → Task 3; §2.5 QA loop + maxPasses (Q3=3) → Task 4; §3.1 Envelope→transcript projection (total over MessageKind) → Task 5; §7 test plan + README/seam → Task 6. Phase B/C are deferred by design; no tasks here (correct).

**Placeholder scan:** every code step shows complete code; no TBD/TODO.

**Type consistency:** `Specialty` (Task 1) is consumed identically in Tasks 2/3/5; `planToTasks` returns `TaskEntry` matching ledger.ts exactly (`state`,`phase`,`dependsOn`); `qaVerification` returns `Verification` matching status.ts (`matrix`,`droveRealFlow`,`evidence`); `toTranscriptEvent` covers exactly the `MessageKind` union defined in Task 2.
