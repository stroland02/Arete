import { describe, expect, it } from "vitest";
import { projectStatusBoard } from "./status-board";
import type { SynthStep } from "./types";

const step = (agent: string, confidence: number, at: string, blockers: string[] = []): SynthStep => ({
  kind: "report",
  agentId: agent,
  text: "…",
  at,
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
