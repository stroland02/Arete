import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBoard } from "./status-board";
import type { SynthStep } from "@/lib/issue-pipeline/types";

const step = (agent: string, confidence: number, at: string, blockers: string[] = []): SynthStep => ({
  kind: "report",
  agentId: agent,
  text: "…",
  at,
  report: { agent, dimension: agent as never, status: "done", summary: "…", confidence, blockers },
});

describe("StatusBoard", () => {
  it("renders one row per specialist with status, confidence and escalation", () => {
    const html = renderToStaticMarkup(<StatusBoard steps={[step("security", 0.5, "t1", ["need repo access"])]} />);
    expect(html).toContain("security");
    expect(html).toContain("50%");
    expect(html).toContain("↑ synth"); // 0.5 < DEFAULT_LOW_CONFIDENCE
    expect(html).toContain("need repo access");
  });

  it("renders nothing when no specialist has reported (honest empty)", () => {
    const html = renderToStaticMarkup(<StatusBoard steps={[{ kind: "dispatch", text: "…", at: "t0" }]} />);
    expect(html).toBe("");
  });
});
