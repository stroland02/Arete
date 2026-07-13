import { describe, it, expect } from "vitest";
import type { Diff, Finding } from "./types";
import { assertNoFabrication } from "./pipeline";
import { verifyHybrid, makeFixtureCritic, type CriticFn, type CriticVerdict } from "./critic";

const now = () => "2026-07-13T00:00:00Z";

function cand(over: Partial<Finding>): Finding {
  return {
    id: "f",
    agentId: "security",
    category: "security",
    file: "src/a.ts",
    line: 10,
    rationale: "reason",
    diff: [],
    verdict: "candidate",
    ...over,
  };
}

const diff: Diff = [
  { file: "src/a.ts", line: 10 },
  { file: "src/b.ts", line: 20 },
];

const uphold: CriticVerdict = { verdict: "uphold", rationale: "holds", confidence: 0.9 };
const drop: CriticVerdict = { verdict: "drop", rationale: "reasoning doesn't hold", confidence: 0.8 };

describe("verifyHybrid — containment law kept ⊆ gatePassed ⊆ candidates", () => {
  it("a gate-failed finding is dropped and never reaches the Critic", async () => {
    let criticCalls = 0;
    const critic: CriticFn = async () => {
      criticCalls++;
      return uphold;
    };
    const r = await verifyHybrid([cand({ id: "x", file: "src/z.ts", line: 99 })], diff, critic, { now });
    expect(r.kept).toBe(0);
    expect(r.gatePassed).toBe(0);
    expect(criticCalls).toBe(0); // the Critic is never consulted for a gate-fail
    expect(r.findings[0].verdict).toBe("dropped");
  });

  it("even a Critic that upholds EVERYTHING cannot resurrect a gate-failed finding", async () => {
    const alwaysUphold = makeFixtureCritic({}, uphold);
    const candidates = [
      cand({ id: "in", file: "src/a.ts", line: 10 }), // in diff
      cand({ id: "out", file: "src/nope.ts", line: 1 }), // NOT in diff
    ];
    const r = await verifyHybrid(candidates, diff, alwaysUphold, { now });
    const keptIds = r.findings.filter((f) => f.verdict === "kept").map((f) => f.id);
    expect(keptIds).toEqual(["in"]); // "out" can never be kept
    expect(r.kept).toBeLessThanOrEqual(r.gatePassed);
    expect(r.gatePassed).toBeLessThanOrEqual(candidates.length);
    expect(() => assertNoFabrication(r.findings, diff)).not.toThrow();
  });

  it("property: over many verdict combinations the containment law + no-fabrication always hold", async () => {
    const candidates = [
      cand({ id: "a", file: "src/a.ts", line: 10 }), // gate pass
      cand({ id: "b", file: "src/b.ts", line: 20 }), // gate pass
      cand({ id: "c", file: "src/x.ts", line: 1 }), // gate fail
      cand({ id: "d", file: "src/y.ts", line: 2 }), // gate fail
    ];
    for (let trial = 0; trial < 40; trial++) {
      const critic: CriticFn = async () =>
        Math.random() < 0.5
          ? { verdict: "uphold", rationale: "r", confidence: Math.random() }
          : { verdict: "drop", rationale: "r", confidence: Math.random() };
      const r = await verifyHybrid(candidates, diff, critic, { now });
      const kept = r.findings.filter((f) => f.verdict === "kept");
      expect(r.kept).toBeLessThanOrEqual(r.gatePassed);
      expect(r.gatePassed).toBe(2); // exactly a and b pass the gate, every trial
      expect(() => assertNoFabrication(r.findings, diff)).not.toThrow();
      for (const f of kept) expect(["a", "b"]).toContain(f.id);
    }
  });
});

describe("verifyHybrid — Critic behaviour", () => {
  it("a Critic drop overrules a gate-passed finding, with the Critic's reason", async () => {
    const critic = makeFixtureCritic({ a: drop });
    const r = await verifyHybrid([cand({ id: "a", file: "src/a.ts", line: 10 })], diff, critic, { now });
    expect(r.findings[0].verdict).toBe("dropped");
    expect(r.findings[0].droppedReason).toContain("reasoning doesn't hold");
  });

  it("a low-confidence uphold is kept but flagged needs-attention", async () => {
    const critic = makeFixtureCritic({ a: { verdict: "uphold", rationale: "maybe", confidence: 0.55 } });
    const r = await verifyHybrid([cand({ id: "a", file: "src/a.ts", line: 10 })], diff, critic, { now, lowConfidence: 0.7 });
    expect(r.findings[0].verdict).toBe("kept");
    const keepStep = r.transcript.find((s) => s.kind === "keep");
    expect(keepStep?.needsAttention).toBe(true);
  });

  it("a Critic error fails OPEN — the gate-proven finding is kept and flagged", async () => {
    const critic: CriticFn = async () => {
      throw new Error("model timeout");
    };
    const r = await verifyHybrid([cand({ id: "a", file: "src/a.ts", line: 10 })], diff, critic, { now });
    expect(r.findings[0].verdict).toBe("kept"); // never a silent drop of a real finding
    const keepStep = r.transcript.find((s) => s.kind === "keep");
    expect(keepStep?.needsAttention).toBe(true);
    expect(() => assertNoFabrication(r.findings, diff)).not.toThrow();
  });
});
