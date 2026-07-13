import { describe, it, expect } from "vitest";
import { reviewToContainer, type ProjectedReview } from "./review-projection";
import { assertPrIntegrity } from "./pipeline";

function review(over: Partial<ProjectedReview> = {}): ProjectedReview {
  return {
    id: "rev-1",
    prNumber: 42,
    riskLevel: "high",
    overallSummary: "Two issues worth a look.",
    analysisStatus: "completed",
    createdAt: "2026-07-13T12:00:00Z",
    repositoryFullName: "acme/payments-api",
    findings: [
      { id: "c1", path: "src/a.ts", line: 10, body: "Unsafe parse.", severity: "error", category: "security" },
      { id: "c2", path: "src/b.ts", line: 20, body: "N+1 query.", severity: "warning", category: "performance" },
    ],
    ...over,
  };
}

describe("reviewToContainer", () => {
  it("maps a review onto a terminal container keyed by the review id", () => {
    const c = reviewToContainer(review(), "inst-1");
    expect(c.id).toBe("rev-1");
    expect(c.installationId).toBe("inst-1");
    expect(c.state).toBe("posted");
    expect(c.source).toBe("Kuma");
    expect(c.serviceId).toBe("acme/payments-api");
    expect(c.pr?.number).toBe(42);
  });

  it("every review comment becomes a KEPT finding (all verified upstream)", () => {
    const c = reviewToContainer(review(), "inst-1");
    expect(c.findings).toHaveLength(2);
    expect(c.findings.every((f) => f.verdict === "kept")).toBe(true);
    expect(c.findings.map((f) => f.agentId)).toEqual(["security", "performance"]); // category == agent id
  });

  it("reconstructs a dispatch → (verify,keep)* → compose → posted transcript, no dropped", () => {
    const c = reviewToContainer(review(), "inst-1");
    const kinds = c.transcript.map((s) => s.kind);
    expect(kinds[0]).toBe("dispatch");
    expect(kinds[kinds.length - 1]).toBe("posted");
    expect(kinds.filter((k) => k === "keep")).toHaveLength(2);
    expect(kinds.filter((k) => k === "verify")).toHaveLength(2);
    expect(kinds).not.toContain("drop"); // nothing invented
  });

  it("PR comments trace 1:1 to kept findings (assertPrIntegrity holds)", () => {
    const c = reviewToContainer(review(), "inst-1");
    expect(c.pr?.comments).toHaveLength(2);
    expect(() => assertPrIntegrity(c.pr!, c.findings)).not.toThrow();
  });

  it("maps risk level onto the modelled severity tiers", () => {
    expect(reviewToContainer(review({ riskLevel: "critical" }), "i").severity).toBe("critical");
    expect(reviewToContainer(review({ riskLevel: "high" }), "i").severity).toBe("high");
    expect(reviewToContainer(review({ riskLevel: "low" }), "i").severity).toBe("medium");
    expect(reviewToContainer(review({ riskLevel: "medium" }), "i").severity).toBe("medium");
  });

  it("handles a clean review (no findings) without inventing anything", () => {
    const c = reviewToContainer(review({ findings: [] }), "inst-1");
    expect(c.findings).toHaveLength(0);
    expect(c.pr?.comments).toHaveLength(0);
    expect(c.transcript.some((s) => s.kind === "keep")).toBe(false);
    expect(c.transcript[0].kind).toBe("dispatch");
  });
});
