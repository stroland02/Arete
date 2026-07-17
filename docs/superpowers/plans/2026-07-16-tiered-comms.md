# Tiered Agent Communications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize the agent↔synthesizer star-topology with a structured StatusReport, a deterministic escalation ladder, and a live situational-awareness board (spec: `docs/superpowers/specs/2026-07-16-tiered-comms-design.md`).

**Architecture:** Three pure additions over existing rails — a `StatusReport` schema + escalation ladder in `@arete/orchestration` (types + pure functions, no IO), driver emission riding the EXISTING SynthStep kinds over the existing SSE, and a board projection rendered inside the Services Synth panel. Python agents (Eng3) populate real status/blockers.

**Tech Stack:** TypeScript (packages/orchestration, packages/dashboard — vitest), Python/Pydantic (packages/agents — pytest).

## Global Constraints

- **No new SynthStep kinds** — the console renderer must keep working unchanged; StatusReport rides as an OPTIONAL field on existing steps.
- **Anti-fabrication:** status/confidence/blockers come from real run state (agent + critic). A missing report renders absent/stale, never a fake "on_track". Never invent a dimension for an unknown agent — omit the structured report instead.
- **Threshold single-source:** the ladder takes the threshold as a PARAMETER; the dashboard passes `DEFAULT_LOW_CONFIDENCE` from `packages/dashboard/src/lib/issue-pipeline/critic.ts:41` (value 0.7). `@arete/orchestration` stays dependency-free (types + pure functions only, no runtime/IO — its charter).
- **HITL moat unchanged:** the ladder's human tier maps to the driver's existing `escalated` outcome / hold-at-`ready`; nothing auto-advances.
- TDD every task; commit per task. Eng2 tasks land on `feat/wave2-fix-ui`; Eng3 task on `stroland02/Engineer-3`.
- The existing `packages/orchestration/src/status.ts` models the HUMAN fleet's status contract — do not touch it; the new module is `status-report.ts` (specialist reports), a sibling.

---

### Task 1: StatusReport schema + validator (`@arete/orchestration`) — Eng2

**Files:**
- Create: `packages/orchestration/src/status-report.ts`
- Create: `packages/orchestration/src/status-report.test.ts` (match the package's existing test layout)
- Modify: `packages/orchestration/src/index.ts` (add `export * from "./status-report.js";`)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `ReviewDimension`, `SpecialistStatus`, `StatusReport`, `validateStatusReport(input: unknown): { ok: true; value: StatusReport } | { ok: false; error: string }`, `REVIEW_DIMENSIONS`, `isReviewDimension(x: string): x is ReviewDimension`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { isReviewDimension, validateStatusReport } from "./status-report.js";

const good = {
  agent: "security",
  dimension: "security",
  status: "on_track",
  summary: "No injection risks in the changed handlers",
  confidence: 0.92,
  blockers: [],
};

describe("validateStatusReport", () => {
  it("accepts a well-formed report", () => {
    const r = validateStatusReport(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.dimension).toBe("security");
  });
  it("rejects an unknown dimension", () => {
    const r = validateStatusReport({ ...good, dimension: "vibes" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dimension/);
  });
  it("rejects an unknown status", () => {
    expect(validateStatusReport({ ...good, status: "chilling" }).ok).toBe(false);
  });
  it("rejects confidence outside [0,1]", () => {
    expect(validateStatusReport({ ...good, confidence: 1.2 }).ok).toBe(false);
    expect(validateStatusReport({ ...good, confidence: -0.1 }).ok).toBe(false);
  });
  it("rejects non-string blockers and empty summary", () => {
    expect(validateStatusReport({ ...good, blockers: [1] }).ok).toBe(false);
    expect(validateStatusReport({ ...good, summary: "" }).ok).toBe(false);
  });
  it("isReviewDimension narrows", () => {
    expect(isReviewDimension("performance")).toBe(true);
    expect(isReviewDimension("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @arete/orchestration test -- status-report` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/orchestration/src/status-report.ts
// The specialist→PM "tiered-meeting update" (Fabriq-formalized star-topology,
// spec 2026-07-16-tiered-comms-design.md §2). Distinct from ./status.ts, which
// models the HUMAN fleet's status contract. Pure types + validator; no IO.

export const REVIEW_DIMENSIONS = [
  "security",
  "performance",
  "quality",
  "test_coverage",
  "deployment_safety",
  "business_logic",
] as const;
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];

export function isReviewDimension(x: string): x is ReviewDimension {
  return (REVIEW_DIMENSIONS as readonly string[]).includes(x);
}

export const SPECIALIST_STATUSES = [
  "on_track",
  "blocked",
  "needs_input",
  "escalating",
  "done",
] as const;
export type SpecialistStatus = (typeof SPECIALIST_STATUSES)[number];

export interface StatusReport {
  agent: string;
  dimension: ReviewDimension;
  status: SpecialistStatus;
  /** The single most-relevant line — never empty. */
  summary: string;
  /** REAL, from the agent/critic — never synthesized for display. In [0,1]. */
  confidence: number;
  /** Bottom-up "what I need" signal; may be empty. */
  blockers: string[];
}

export type StatusReportValidation =
  | { ok: true; value: StatusReport }
  | { ok: false; error: string };

export function validateStatusReport(input: unknown): StatusReportValidation {
  if (typeof input !== "object" || input === null) return { ok: false, error: "not an object" };
  const r = input as Record<string, unknown>;
  if (typeof r.agent !== "string" || r.agent === "") return { ok: false, error: "agent must be a non-empty string" };
  if (typeof r.dimension !== "string" || !isReviewDimension(r.dimension))
    return { ok: false, error: `unknown dimension: ${String(r.dimension)}` };
  if (typeof r.status !== "string" || !(SPECIALIST_STATUSES as readonly string[]).includes(r.status))
    return { ok: false, error: `unknown status: ${String(r.status)}` };
  if (typeof r.summary !== "string" || r.summary === "") return { ok: false, error: "summary must be a non-empty string" };
  if (typeof r.confidence !== "number" || !(r.confidence >= 0 && r.confidence <= 1))
    return { ok: false, error: "confidence must be a number in [0,1]" };
  if (!Array.isArray(r.blockers) || r.blockers.some((b) => typeof b !== "string"))
    return { ok: false, error: "blockers must be string[]" };
  return {
    ok: true,
    value: {
      agent: r.agent,
      dimension: r.dimension,
      status: r.status as SpecialistStatus,
      summary: r.summary,
      confidence: r.confidence,
      blockers: r.blockers as string[],
    },
  };
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS. Add the export line to `index.ts`; run the package's full suite + `tsc` → green.

- [ ] **Step 5: Commit** — `feat(orchestration): StatusReport schema + validator (tiered comms §2)`

---

### Task 2: Escalation ladder (`@arete/orchestration`) — Eng2

**Files:**
- Create: `packages/orchestration/src/escalation.ts`
- Create: `packages/orchestration/src/escalation.test.ts`
- Modify: `packages/orchestration/src/index.ts` (add `export * from "./escalation.js";`)

**Interfaces:**
- Consumes: `StatusReport`, `SpecialistStatus` from Task 1.
- Produces: `EscalationTier = "none" | "synth" | "human"`, `escalationTier(report: StatusReport, lowConfidenceThreshold: number): EscalationTier`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { escalationTier } from "./escalation.js";
import type { StatusReport } from "./status-report.js";

const base: StatusReport = {
  agent: "security", dimension: "security", status: "on_track",
  summary: "clean", confidence: 0.9, blockers: [],
};
const T = 0.7; // the dashboard passes critic.DEFAULT_LOW_CONFIDENCE

describe("escalationTier", () => {
  it("on_track + confident → none", () => expect(escalationTier(base, T)).toBe("none"));
  it("done + confident → none", () => expect(escalationTier({ ...base, status: "done" }, T)).toBe("none"));
  it("low confidence → synth (even when on_track)", () =>
    expect(escalationTier({ ...base, confidence: 0.5 }, T)).toBe("synth"));
  it("exactly at threshold → none (ladder is < threshold, matching the ⚑ flag)", () =>
    expect(escalationTier({ ...base, confidence: T }, T)).toBe("none"));
  it("blocked → synth regardless of confidence", () =>
    expect(escalationTier({ ...base, status: "blocked", confidence: 0.99 }, T)).toBe("synth"));
  it("needs_input → synth", () =>
    expect(escalationTier({ ...base, status: "needs_input" }, T)).toBe("synth"));
  it("escalating → human (specialist explicitly hands past the synth)", () =>
    expect(escalationTier({ ...base, status: "escalating" }, T)).toBe("human"));
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @arete/orchestration test -- escalation` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/orchestration/src/escalation.ts
// Deterministic escalation ladder (spec §3). No LLM judgment; threshold is a
// PARAMETER (dashboard passes critic.DEFAULT_LOW_CONFIDENCE) so this package
// stays dependency-free. Rule 3 of the spec (synth cannot compose → human) is
// the driver's existing `escalated` outcome — not re-modeled here.
import type { StatusReport } from "./status-report.js";

export type EscalationTier = "none" | "synth" | "human";

export function escalationTier(report: StatusReport, lowConfidenceThreshold: number): EscalationTier {
  if (report.status === "escalating") return "human";
  if (report.status === "blocked" || report.status === "needs_input") return "synth";
  if (report.confidence < lowConfidenceThreshold) return "synth";
  return "none";
}
```

- [ ] **Step 4: Run to verify pass** — suite + `tsc` green (add the index export).

- [ ] **Step 5: Commit** — `feat(orchestration): deterministic escalation ladder (tiered comms §3)`

---

### Task 3: Driver emission — StatusReport rides existing SynthSteps (dashboard) — Eng2

**Files:**
- Modify: `packages/dashboard/src/lib/issue-pipeline/types.ts` (SynthStep gains OPTIONAL `report?: StatusReport`)
- Modify: `packages/dashboard/src/lib/issue-pipeline/driver.ts` (attach on `kind: "report"` steps, in the step-2 specialists loop)
- Test: `packages/dashboard/src/lib/issue-pipeline/driver.test.ts` (extend)

**Interfaces:**
- Consumes: `StatusReport`, `isReviewDimension`, `validateStatusReport` (Task 1); existing `SpecialistReport { agentId, label, candidates }`, `DEFAULT_LOW_CONFIDENCE` from `./critic`.
- Produces: `SynthStep.report?: StatusReport`; `SpecialistReport` gains optional `status?`, `confidence?`, `blockers?` (live-harness inputs — Task 6's consumer contract).

- [ ] **Step 1: Write the failing tests** (extend `driver.test.ts`; reuse its existing fixture helpers for container/plan/diff)

```ts
it("attaches a StatusReport to each specialist report step", () => {
  const { steps } = driveContainer(baseInput()); // existing fixture builder
  const reportSteps = steps.filter((s) => s.kind === "report");
  expect(reportSteps.length).toBeGreaterThan(0);
  for (const s of reportSteps) {
    expect(s.report).toBeDefined();
    expect(validateStatusReport(s.report).ok).toBe(true);
  }
});

it("derives confidence from the weakest candidate, never invents it", () => {
  const input = baseInput();
  input.reports[0].candidates[0].confidence = 0.4; // below DEFAULT_LOW_CONFIDENCE
  const { steps } = driveContainer(input);
  const s = steps.find((x) => x.kind === "report" && x.agentId === input.reports[0].agentId)!;
  expect(s.report!.confidence).toBe(0.4);
  expect(s.report!.status).toBe("done"); // reported = done; low confidence is the ladder's signal
});

it("omits the StatusReport for an agent whose id is not a review dimension", () => {
  const input = baseInput();
  input.reports.push({ agentId: "ci_diagnostics", label: "CI", candidates: [] });
  const { steps } = driveContainer(input);
  const s = steps.find((x) => x.kind === "report" && x.agentId === "ci_diagnostics")!;
  expect(s.report).toBeUndefined(); // anti-fabrication: never invent a dimension
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @arete/dashboard test -- driver` → FAIL (`report` undefined).

- [ ] **Step 3: Implement.** In `types.ts`: `import type { StatusReport } from "@arete/orchestration";` and add `report?: StatusReport;` to `SynthStep`. In `driver.ts`, extend `SpecialistReport`:

```ts
export interface SpecialistReport {
  agentId: string;
  label: string;
  candidates: Finding[];
  /** Live-harness inputs (packages/agents populates these — real, never synthesized).
   * When absent, derived honestly: status "done" (they reported), confidence =
   * weakest candidate confidence (1 when there are no candidates to doubt). */
  status?: SpecialistStatus;
  confidence?: number;
  blockers?: string[];
}
```

and in the step-2 loop, before the existing `steps.push`:

```ts
const report = toStatusReport(r);
steps.push({ kind: "report", agentId: r.agentId, text: `...text unchanged...`, at: now(), ...(report ? { report } : {}) });
```

with, at module level:

```ts
function toStatusReport(r: SpecialistReport): StatusReport | undefined {
  if (!isReviewDimension(r.agentId)) return undefined; // never invent a dimension
  const weakest = r.candidates.reduce<number | undefined>(
    (min, c) => (min === undefined || c.confidence < min ? c.confidence : min),
    undefined
  );
  const n = r.candidates.length;
  return {
    agent: r.agentId,
    dimension: r.agentId,
    status: r.status ?? "done",
    summary: `${r.label} reported ${n} candidate${n === 1 ? "" : "s"}`,
    confidence: r.confidence ?? weakest ?? 1,
    blockers: r.blockers ?? [],
  };
}
```

- [ ] **Step 4: Run full dashboard suite + `tsc`** — all green; the console renderer is untouched (optional field, no new kinds).

- [ ] **Step 5: Commit** — `feat(driver): specialist StatusReports ride existing report steps (tiered comms §2)`

---

### Task 4: Board projection (pure) — Eng2

**Files:**
- Create: `packages/dashboard/src/lib/issue-pipeline/status-board.ts`
- Create: `packages/dashboard/src/lib/issue-pipeline/status-board.test.ts`

**Interfaces:**
- Consumes: `SynthStep` (with Task 3's `report?`), `escalationTier` (Task 2), `DEFAULT_LOW_CONFIDENCE` from `./critic`.
- Produces: `BoardRow { agentId: string; dimension: ReviewDimension; status: SpecialistStatus; confidence: number; topBlocker: string | null; escalatedTo: EscalationTier; at: string }`, `projectStatusBoard(steps: SynthStep[]): BoardRow[]` (latest report per agent, order of first appearance).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { projectStatusBoard } from "./status-board.js";
import type { SynthStep } from "./types.js";

const step = (agent: string, confidence: number, at: string, blockers: string[] = []): SynthStep => ({
  kind: "report", agentId: agent, text: "…", at,
  report: { agent, dimension: agent as never, status: "done", summary: "…", confidence, blockers },
});

describe("projectStatusBoard", () => {
  it("keeps the LATEST report per agent", () => {
    const rows = projectStatusBoard([step("security", 0.9, "t1"), step("security", 0.5, "t2")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].confidence).toBe(0.5);
    expect(rows[0].escalatedTo).toBe("synth"); // 0.5 < DEFAULT_LOW_CONFIDENCE
  });
  it("ignores steps without a report (absent, never fabricated)", () => {
    const rows = projectStatusBoard([{ kind: "dispatch", text: "…", at: "t0" }, step("quality", 0.8, "t1")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].agentId).toBe("quality");
    expect(rows[0].escalatedTo).toBe("none");
  });
  it("surfaces the first blocker as topBlocker", () => {
    const rows = projectStatusBoard([step("performance", 0.9, "t1", ["need prod trace", "x"])]);
    expect(rows[0].topBlocker).toBe("need prod trace");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @arete/dashboard test -- status-board` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/dashboard/src/lib/issue-pipeline/status-board.ts
// Situational-awareness board projection (spec §4): a pure fold over the
// existing SynthStep stream — one row per specialist, latest report wins.
// No new transport; the SSE route already carries these steps.
import { escalationTier, type EscalationTier, type ReviewDimension, type SpecialistStatus } from "@arete/orchestration";
import { DEFAULT_LOW_CONFIDENCE } from "./critic";
import type { SynthStep } from "./types";

export interface BoardRow {
  agentId: string;
  dimension: ReviewDimension;
  status: SpecialistStatus;
  confidence: number;
  topBlocker: string | null;
  escalatedTo: EscalationTier;
  at: string;
}

export function projectStatusBoard(steps: SynthStep[]): BoardRow[] {
  const rows = new Map<string, BoardRow>();
  for (const s of steps) {
    if (!s.report) continue;
    const r = s.report;
    rows.set(r.agent, {
      agentId: r.agent,
      dimension: r.dimension,
      status: r.status,
      confidence: r.confidence,
      topBlocker: r.blockers[0] ?? null,
      escalatedTo: escalationTier(r, DEFAULT_LOW_CONFIDENCE),
      at: s.at,
    });
  }
  return [...rows.values()];
}
```

- [ ] **Step 4: Run to verify pass** — suite + `tsc` green.

- [ ] **Step 5: Commit** — `feat(dashboard): status-board projection over the SynthStep stream (tiered comms §4)`

---

### Task 5: Board rendering in the Services Synth panel — Eng2

**Files:**
- Create: `packages/dashboard/src/components/dashboard/services/status-board.tsx`
- Modify: the Synth panel in `packages/dashboard/src/components/dashboard/services/services-workspace.tsx` (render `<StatusBoard steps={...}/>` above the transcript console, fed by the SAME steps array the console already receives)
- Test: `packages/dashboard/src/components/dashboard/services/status-board.test.tsx`

**Interfaces:**
- Consumes: `projectStatusBoard`, `BoardRow` (Task 4).
- Produces: `StatusBoard({ steps }: { steps: SynthStep[] })` — renders `null` when no reports exist yet (honest empty, no skeleton rows).

- [ ] **Step 1: Write the failing tests** (testing-library, matching the component-test style already in `services/`; reuse Task 4's `step()` helper)

```tsx
it("renders one row per specialist with status, confidence and escalation", () => {
  render(<StatusBoard steps={[step("security", 0.5, "t1", ["need repo access"])]} />);
  expect(screen.getByText("security")).toBeInTheDocument();
  expect(screen.getByText(/50%/)).toBeInTheDocument();
  expect(screen.getByText(/↑ synth/)).toBeInTheDocument();
  expect(screen.getByText("need repo access")).toBeInTheDocument();
});
it("renders nothing when no specialist has reported (honest empty)", () => {
  const { container } = render(<StatusBoard steps={[{ kind: "dispatch", text: "…", at: "t0" }]} />);
  expect(container.firstChild).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @arete/dashboard test -- status-board` → FAIL.

- [ ] **Step 3: Implement** a compact grid: per row — dimension label, status pill (reuse the workspace's existing pill/dot style helpers, e.g. the `riskPill`-style classes), `Math.round(confidence * 100)%`, `topBlocker` line when present, `↑ synth` / `↑ human` badge when `escalatedTo !== "none"`. Component body: `const rows = projectStatusBoard(steps); if (rows.length === 0) return null;` then map rows.

- [ ] **Step 4: Run full suite + `tsc`** — green. Visually verify on `/services`: the live-driven sample streams rows in as reports arrive.

- [ ] **Step 5: Commit** — `feat(services): situational-awareness board over the live Synth stream (tiered comms §4)`

---

### Task 6: Real specialist status from the agents service (Python) — Eng3

**Files:**
- Modify: `packages/agents/src/arete_agents/models/review.py` (add `AgentStatus`; `ReviewResult` gains `agent_statuses: list[AgentStatus] = []`)
- Modify: `packages/agents/src/arete_agents/orchestrator.py` (populate one `AgentStatus` per dispatched role from REAL run state)
- Test: `packages/agents/tests/test_agent_status.py`

**Interfaces:**
- Consumes: nothing new (rides existing orchestrator run state + critic confidence).
- Produces: `AgentStatus(BaseModel)` with `agent: str`, `status: Literal["on_track","blocked","needs_input","escalating","done"]`, `summary: str`, `confidence: float` (0–1), `blockers: list[str]` — the JSON shape `SpecialistReport.status/confidence/blockers` (Task 3) consumes when the live harness bridges `/review` output into `DriveInput`. Field names mirror `StatusReport` exactly.

- [ ] **Step 1: Write the failing tests**

```python
def test_completed_agent_reports_done_with_real_confidence():
    result = run_review_with_stub_llm()  # adapt to the suite's existing LLM-stub fixture
    statuses = {s.agent: s for s in result.agent_statuses}
    assert "security" in statuses
    s = statuses["security"]
    assert s.status == "done"
    assert 0.0 <= s.confidence <= 1.0
    assert s.blockers == []

def test_failed_agent_reports_blocked_with_the_error_as_blocker():
    result = run_review_with_agent_exception("performance")  # fixture: that agent raises
    s = {x.agent: x for x in result.agent_statuses}["performance"]
    assert s.status == "blocked"
    assert len(s.blockers) == 1  # the real error string, never invented
```

- [ ] **Step 2: Run to verify failure** — `pytest packages/agents/tests/test_agent_status.py -v` → FAIL (`agent_statuses` missing).

- [ ] **Step 3: Implement.** In `models/review.py`:

```python
class AgentStatus(BaseModel):
    """One specialist's tiered-meeting update (tiered-comms spec §2). All
    fields are REAL run state — status from whether the agent completed,
    confidence from the critic/agent output, blockers from actual errors.
    Never synthesized for display (anti-fabrication rule)."""
    agent: str
    status: Literal["on_track", "blocked", "needs_input", "escalating", "done"]
    summary: str
    confidence: float = Field(ge=0.0, le=1.0)
    blockers: list[str] = []
```

In `orchestrator.py`, where each specialist's run completes (both paths already exist): on success append `AgentStatus(agent=role, status="done", summary=<the agent's own summary line>, confidence=<min finding confidence, or 1.0 with no findings>, blockers=[])`; on the exception path append `AgentStatus(agent=role, status="blocked", summary=f"{role} failed", confidence=0.0, blockers=[str(err)])`. Attach the list to the returned `ReviewResult`.

- [ ] **Step 4: Run the full agents suite** — `pytest packages/agents -q` → green.

- [ ] **Step 5: Commit** — `feat(agents): per-specialist AgentStatus in ReviewResult — real status/confidence/blockers (tiered comms §2)`

---

## Self-review (done)

- **Spec coverage:** §2 → Tasks 1, 3, 6; §3 → Task 2 (rule 3 documented as the driver's existing `escalated` outcome); §4 → Tasks 4, 5; §7 integrity → Global Constraints + the omission/blocked paths in Tasks 3, 6; §9 out-of-scope respected (no DB, no new step kinds, no new transport).
- **Type consistency:** `StatusReport`/`SpecialistStatus`/`ReviewDimension` (Task 1) used verbatim in Tasks 3–5; `escalationTier(report, threshold)` (Task 2) consumed in Task 4; Python `AgentStatus` field names mirror `StatusReport` exactly (Task 6 → Task 3 bridge).
- **Placeholders:** none — every code step shows the code.
