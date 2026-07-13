import { describe, it, expect } from "vitest";
import type { IssueContainer } from "@/lib/issue-pipeline/types";
import { SAMPLE_CONTAINERS } from "@/lib/issue-pipeline/sample-containers";
import {
  initialSynthStreamState,
  synthStreamReducer,
  deriveSynthView,
  type SynthStreamState,
} from "./synth-stream-model";

const working = SAMPLE_CONTAINERS.find((c) => c.id === "sample-working") as IssueContainer;
const done = SAMPLE_CONTAINERS.find((c) => c.id === "sample-done") as IssueContainer;

/** Replay a container through the reducer: init → each step → done. */
function replay(container: IssueContainer, upTo = container.transcript.length): SynthStreamState {
  let s = synthStreamReducer(initialSynthStreamState, { type: "init", container });
  for (const step of container.transcript.slice(0, upTo)) {
    s = synthStreamReducer(s, { type: "step", step });
  }
  if (upTo >= container.transcript.length) s = synthStreamReducer(s, { type: "done" });
  return s;
}

describe("synthStreamReducer", () => {
  it("appends steps in arrival order", () => {
    const s = replay(working);
    const kinds = s.steps.map((x) => x.kind);
    expect(kinds).toEqual(working.transcript.map((x) => x.kind));
  });

  it("marks done only after a done event", () => {
    let s = synthStreamReducer(initialSynthStreamState, { type: "init", container: working });
    s = synthStreamReducer(s, { type: "step", step: working.transcript[0] });
    expect(s.done).toBe(false);
    s = synthStreamReducer(s, { type: "done" });
    expect(s.done).toBe(true);
  });

  it("an error event records the message and closes the stream", () => {
    const s = synthStreamReducer(initialSynthStreamState, { type: "error", message: "boom" });
    expect(s.error).toBe("boom");
    expect(s.done).toBe(true);
  });
});

describe("deriveSynthView — counts from the stream", () => {
  it("counts kept, dropped, and needs-attention from step kinds, not init.findings", () => {
    const v = deriveSynthView(replay(working));
    expect(v.kept).toBe(2); // f-sec-1, f-biz-1
    expect(v.dropped).toBe(1); // f-sec-2
    expect(v.needsAttention).toBe(1); // f-biz-1 flagged
  });

  it("lists reported agents once each, in first-seen order", () => {
    const v = deriveSynthView(replay(working));
    expect(v.reportedAgentIds).toEqual(["security", "business_logic"]);
  });

  it("counts climb as steps arrive (live ledger)", () => {
    const keepIdx = working.transcript.findIndex((s) => s.kind === "keep");
    const early = deriveSynthView(replay(working, keepIdx)); // before first keep
    const later = deriveSynthView(replay(working, keepIdx + 1)); // after first keep
    expect(early.kept).toBe(0);
    expect(later.kept).toBe(1);
  });
});

describe("deriveSynthView — effective phase", () => {
  it("is working while solving, then ready once the posted step arrives", () => {
    const postedIdx = working.transcript.findIndex((s) => s.kind === "posted");
    const midStream = deriveSynthView(replay(working, postedIdx)); // before posted
    expect(midStream.phase).toBe("working");
    expect(midStream.ready).toBe(false);

    const afterPosted = deriveSynthView(replay(working)); // includes posted + done
    expect(afterPosted.phase).toBe("ready");
    expect(afterPosted.ready).toBe(true);
  });

  it("a terminal (posted) container derives phase 'done' regardless of stream", () => {
    const v = deriveSynthView(replay(done));
    expect(v.phase).toBe("done");
    expect(v.prState).toBe("posted");
  });

  it("is idle before init", () => {
    const v = deriveSynthView(initialSynthStreamState);
    expect(v.phase).toBe("idle");
    expect(v.steps).toHaveLength(0);
  });
});
