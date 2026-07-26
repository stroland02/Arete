import { describe, it, expect } from "vitest";
import type { DispatchPlan } from "@arete/orchestration";
import { validateStatusReport } from "@arete/orchestration";
import { driveContainer, type DriveInput, type SpecialistReport } from "./driver";
import type { Diff, Finding, IssueContainer } from "./types";

const AT = "2026-07-16T00:00:00Z";
const now = () => AT;

function detecting(): IssueContainer {
  return {
    id: "c1",
    installationId: "inst-1",
    serviceId: "payments-api",
    fingerprint: "payments-api::typeerror::charge()",
    source: "Sentry",
    severity: "critical",
    state: "detecting",
    firstSeen: AT,
    lastSeen: AT,
    occurrences: 1,
    evidence: [],
    findings: [],
    transcript: [],
    pr: null,
    gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
    createdAt: AT,
    updatedAt: AT,
  };
}

// PM-distributor output: a variable roster (NOT the fixed six), design §2.2.
function plan(): DispatchPlan {
  return {
    problemId: "c1",
    analysis: "null deref in checkout submit",
    assignments: [
      { specialty: "root-cause", taskId: "rc", title: "localize", owner: "a", dependsOn: [], lane: { packages: ["packages/web"], globs: [] } },
      { specialty: "fix-author", taskId: "fix", title: "author fix", owner: "b", dependsOn: ["rc"], lane: { packages: ["packages/web"], globs: [] } },
      { specialty: "qa", taskId: "qa", title: "validate", owner: "q", dependsOn: ["fix"], lane: { packages: [], globs: ["packages/web/e2e/**"] } },
    ],
  };
}

function finding(id: string, line: number): Finding {
  return {
    id,
    agentId: "security",
    category: "security",
    file: "src/checkout/submit.ts",
    line,
    rationale: `issue at ${line}`,
    diff: [],
    verdict: "candidate",
  };
}

function reports(): SpecialistReport[] {
  return [
    { agentId: "security", label: "Security", candidates: [finding("f1", 42), finding("f2", 99)] },
  ];
}

// Only line 42 is in the diff — f1 is evidenced (kept), f2 is not (dropped).
const diff: Diff = [{ file: "src/checkout/submit.ts", line: 42 }];

function baseInput(overrides: Partial<DriveInput> = {}): DriveInput {
  return {
    container: detecting(),
    plan: plan(),
    reports: reports(),
    diff,
    qaResults: [{ pass: true }],
    compose: { base: "main", branch: "arete/fix-c1" },
    now,
    ...overrides,
  };
}

describe("driveContainer", () => {
  it("advances detecting -> ready on a QA pass, in the console's step order", () => {
    const r = driveContainer(baseInput());

    expect(r.outcome).toBe("ready");
    expect(r.container.state).toBe("ready");

    const kinds = r.steps.map((s) => s.kind);
    expect(kinds[0]).toBe("dispatch");
    expect(kinds[1]).toBe("report");
    // verify/keep/drop are emitted by verifyAll, then compose, then posted last.
    expect(kinds).toContain("verify");
    expect(kinds).toContain("keep");
    expect(kinds).toContain("drop");
    expect(kinds[kinds.length - 2]).toBe("compose");
    expect(kinds[kinds.length - 1]).toBe("posted");
  });

  it("keeps only diff-evidenced findings — no fabrication in the PR", () => {
    const r = driveContainer(baseInput());
    expect(r.kept).toBe(1);
    expect(r.dropped).toBe(1);
    expect(r.container.pr).not.toBeNull();
    expect(r.container.pr!.comments.map((c) => c.findingId)).toEqual(["f1"]);
  });

  it("the dispatch step reflects the PM's variable roster, not a fixed six", () => {
    const r = driveContainer(baseInput());
    const dispatch = r.steps.find((s) => s.kind === "dispatch")!;
    expect(dispatch.text).toContain("3 specialists");
    expect(dispatch.detail).toContain("null deref in checkout submit");
    expect(dispatch.detail).toContain("root-cause");
    expect(dispatch.detail).toContain("qa");
  });

  it("on a QA failure then pass, emits a re-dispatch step carrying the exact error", () => {
    const r = driveContainer(baseInput({ qaResults: [{ pass: false, error: "500 on submit" }, { pass: true }] }));
    expect(r.outcome).toBe("ready");
    expect(r.container.state).toBe("ready");
    const redispatch = r.steps.filter((s) => s.kind === "dispatch");
    // one PM dispatch + one QA re-dispatch
    expect(redispatch).toHaveLength(2);
    expect(redispatch[1].detail).toBe("500 on submit");
  });

  it("escalates to the human after maxPasses without fabricating a ready PR", () => {
    const r = driveContainer(
      baseInput({ maxPasses: 2, qaResults: [{ pass: false, error: "a" }, { pass: false, error: "b" }] }),
    );
    expect(r.outcome).toBe("escalated");
    expect(r.container.state).toBe("verifying"); // did NOT advance to ready
    expect(r.container.pr).toBeNull();
    expect(r.escalationReason).toContain("2 pass");
    expect(r.steps.some((s) => s.kind === "compose")).toBe(false);
    expect(r.steps.some((s) => s.kind === "posted")).toBe(false);
  });

  it("flags a kept finding below the low-confidence threshold as needs-attention", () => {
    const lowConf = { ...finding("f1", 42), confidence: 0.5 };
    const r = driveContainer(
      baseInput({ reports: [{ agentId: "security", label: "Security", candidates: [lowConf] }] }),
    );
    const keep = r.steps.find((s) => s.kind === "keep")!;
    expect(keep.needsAttention).toBe(true);
    expect(keep.text).toContain("human look");
  });

  it("does NOT flag a kept finding at or above the threshold", () => {
    const highConf = { ...finding("f1", 42), confidence: 0.9 };
    const r = driveContainer(
      baseInput({ reports: [{ agentId: "security", label: "Security", candidates: [highConf] }] }),
    );
    const keep = r.steps.find((s) => s.kind === "keep")!;
    expect(keep.needsAttention).toBeUndefined();
  });

  it("attaches a StatusReport to each specialist report step (tiered comms §2)", () => {
    const { steps } = driveContainer(baseInput());
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

  it("rejects a container that is not in the detecting state", () => {
    const c = { ...detecting(), state: "ready" as const };
    expect(() => driveContainer(baseInput({ container: c }))).toThrow(/detecting/);
  });
});
