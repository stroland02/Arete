import { describe, it, expect } from "vitest";
import type { ContainerState, Diff, Finding, IssueContainer } from "./types";
import {
  fingerprint,
  findContainerByFingerprint,
  isEvidencedByDiff,
  verifyAll,
  assertNoFabrication,
  canTransition,
  transition,
  canApprove,
  approveSolution,
  canPost,
  composePr,
  assertPrIntegrity,
} from "./pipeline";

// ── test helpers ────────────────────────────────────────────────────────────
function cand(over: Partial<Finding>): Finding {
  return {
    id: "f1",
    agentId: "security",
    category: "Security",
    file: "src/a.ts",
    line: 10,
    rationale: "reason",
    diff: [],
    verdict: "candidate",
    ...over,
  };
}

function container(state: ContainerState, over: Partial<IssueContainer> = {}): IssueContainer {
  return {
    id: "c1",
    installationId: "i1",
    serviceId: "payments-api",
    fingerprint: "fp",
    source: "Sentry",
    severity: "critical",
    state,
    firstSeen: "2026-07-13T00:00:00Z",
    lastSeen: "2026-07-13T00:00:00Z",
    occurrences: 1,
    evidence: [],
    findings: [],
    transcript: [],
    pr: null,
    gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
    createdAt: "2026-07-13T00:00:00Z",
    updatedAt: "2026-07-13T00:00:00Z",
    ...over,
  };
}

const fixedNow = () => "2026-07-13T00:00:00Z";

// ── fingerprint / dedupe (spec §4.2) ────────────────────────────────────────
describe("fingerprint / dedupe", () => {
  it("normalizes whitespace + case to the same fingerprint", () => {
    const a = fingerprint({ service: "payments-api", errorType: "TypeError", topFrame: "charge()  " });
    const b = fingerprint({ service: "Payments-Api", errorType: "typeerror", topFrame: "charge()" });
    expect(a).toBe(b);
  });

  it("distinguishes different services", () => {
    expect(fingerprint({ service: "a", errorType: "E", topFrame: "f" })).not.toBe(
      fingerprint({ service: "b", errorType: "E", topFrame: "f" }),
    );
  });

  it("routes a repeat event to the existing container, scoped by installation", () => {
    const fp = fingerprint({ service: "s", errorType: "E", topFrame: "f" });
    const containers = [{ id: "c1", installationId: "i1", fingerprint: fp }];
    expect(findContainerByFingerprint(containers, "i1", fp)).toBe("c1"); // idempotent ingest
    expect(findContainerByFingerprint(containers, "i2", fp)).toBeNull(); // no cross-tenant leak
  });
});

// ── verification + no-fabrication invariant (spec §4.5, §5) ─────────────────
describe("verification", () => {
  const diff: Diff = [
    { file: "src/a.ts", line: 10 },
    { file: "src/b.ts", line: 20 },
  ];

  it("keeps a finding whose file:line is in the diff", () => {
    const r = verifyAll([cand({ file: "src/a.ts", line: 10 })], diff, fixedNow);
    expect(r.findings[0].verdict).toBe("kept");
    expect(r.kept).toBe(1);
    expect(r.dropped).toBe(0);
  });

  it("drops a finding not in the diff, with a reason", () => {
    const r = verifyAll([cand({ file: "src/z.ts", line: 99 })], diff, fixedNow);
    expect(r.findings[0].verdict).toBe("dropped");
    expect(r.findings[0].droppedReason).toContain("no evidence");
    expect(r.dropped).toBe(1);
  });

  it("never keeps a finding without diff evidence (the invariant holds across a mix)", () => {
    const cands = [
      cand({ id: "a", file: "src/a.ts", line: 10 }),
      cand({ id: "b", file: "src/x.ts", line: 1 }),
      cand({ id: "c", file: "src/b.ts", line: 20 }),
    ];
    const r = verifyAll(cands, diff, fixedNow);
    expect(r.kept).toBe(2);
    expect(r.dropped).toBe(1);
    expect(() => assertNoFabrication(r.findings, diff)).not.toThrow();
    for (const f of r.findings) {
      if (f.verdict === "kept") expect(isEvidencedByDiff(f, diff)).toBe(true);
    }
  });

  it("emits a verify step then a verdict step per candidate", () => {
    const r = verifyAll([cand({ file: "src/a.ts", line: 10 }), cand({ id: "f2", file: "src/z.ts", line: 9 })], diff, fixedNow);
    expect(r.transcript.map((s) => s.kind)).toEqual(["verify", "keep", "verify", "drop"]);
  });

  it("assertNoFabrication throws if a kept finding is tampered to lack evidence", () => {
    const tampered = [cand({ file: "src/nope.ts", line: 5, verdict: "kept" })];
    expect(() => assertNoFabrication(tampered, diff)).toThrow(/fabrication/);
  });
});

// ── state machine + gates (spec §4, §5) ─────────────────────────────────────
describe("state machine + gates", () => {
  it("allows only legal transitions", () => {
    expect(canTransition("ready", "solution_approved")).toBe(true);
    expect(canTransition("solution_approved", "posted")).toBe(true);
    expect(canTransition("solution_approved", "changes_requested")).toBe(true);
    expect(canTransition("posted", "merged")).toBe(true);
  });

  it("rejects skipping the solution gate", () => {
    expect(canTransition("ready", "posted")).toBe(false);
    expect(canTransition("detecting", "posted")).toBe(false);
    expect(canTransition("verifying", "ready")).toBe(false);
  });

  it("transition() throws on an illegal move and stamps updatedAt on a legal one", () => {
    expect(() => transition(container("ready"), "posted")).toThrow(/illegal transition/);
    const moved = transition(container("ready"), "solution_approved", fixedNow);
    expect(moved.state).toBe("solution_approved");
    expect(moved.updatedAt).toBe("2026-07-13T00:00:00Z");
  });

  it("canApprove holds ONLY at ready — the human gate opens only when the fix is composed", () => {
    expect(canApprove(container("ready"))).toBe(true);
    for (const s of ["detecting", "fanning_out", "verifying", "composing", "solution_approved", "posted"] as ContainerState[]) {
      expect(canApprove(container(s))).toBe(false);
    }
  });

  it("approveSolution crosses ready -> solution_approved and stamps who/when", () => {
    const approved = approveSolution(container("ready"), "alice", () => "2026-07-16T00:00:00Z");
    expect(approved.state).toBe("solution_approved");
    expect(approved.gates.solutionApprovedAt).toBe("2026-07-16T00:00:00Z");
    expect(approved.gates.solutionApprovedBy).toBe("alice");
    // and it now clears the SECOND gate's precondition
    expect(canPost(approved)).toBe(true);
  });

  it("approveSolution refuses any state that is not ready (the moat cannot be jumped)", () => {
    expect(() => approveSolution(container("verifying"), "alice")).toThrow(/cannot approve/);
    expect(() => approveSolution(container("solution_approved"), "alice")).toThrow(/cannot approve/);
  });

  it("canPost requires both the approved state AND the timestamp", () => {
    expect(canPost(container("ready"))).toBe(false);
    expect(canPost(container("solution_approved"))).toBe(false); // state ok, no timestamp
    const approved = container("solution_approved", {
      gates: { solutionApprovedAt: "2026-07-13T00:00:00Z", solutionApprovedBy: "u1", postedAt: null, postedBy: null },
    });
    expect(canPost(approved)).toBe(true);
  });
});

// ── PR composition + comment↔kept invariant (spec §4.6, §3, §5) ─────────────
describe("PR composition", () => {
  const findings: Finding[] = [
    { ...cand({ id: "k1", file: "src/a.ts", line: 10 }), verdict: "kept" },
    { ...cand({ id: "k2", agentId: "performance", category: "Performance", file: "src/b.ts", line: 20 }), verdict: "kept" },
    { ...cand({ id: "d1", file: "src/z.ts", line: 9 }), verdict: "dropped", droppedReason: "unproven" },
  ];

  it("creates one comment per kept finding and none for dropped", () => {
    const pr = composePr({ findings }, { base: "main", branch: "fix/x" });
    expect(pr.comments).toHaveLength(2);
    expect(pr.comments.map((c) => c.findingId)).toEqual(["k1", "k2"]);
    expect(pr.state).toBe("ready");
    expect(pr.number).toBeNull(); // not posted yet
    expect(pr.title).toContain("2 verified findings");
  });

  it("assertPrIntegrity passes for a composed PR and fails when a comment refs a dropped finding", () => {
    const pr = composePr({ findings }, { base: "main", branch: "fix/x" });
    expect(() => assertPrIntegrity(pr, findings)).not.toThrow();
    const bad = { comments: [...pr.comments, { findingId: "d1", file: "src/z.ts", line: 9, body: "x" }] };
    expect(() => assertPrIntegrity(bad, findings)).toThrow(/non-kept/);
  });
});
