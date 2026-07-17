import { describe, it, expect } from "vitest";
import { DRIVEN_WORKING, LIVE_WORKING_ID, getLiveSampleContainer } from "./live-drive";
import { InMemoryContainerStore } from "./container-store";
import type { SynthStep } from "./types";

describe("live-drive: the working container is driveContainer's output", () => {
  it("has an engine-generated transcript in console order (dispatch → report → verify/keep/drop → posted)", () => {
    const kinds = DRIVEN_WORKING.transcript.map((s) => s.kind);
    expect(kinds[0]).toBe("dispatch");
    expect(kinds).toContain("report");
    expect(kinds).toContain("verify");
    expect(kinds).toContain("keep");
    expect(kinds).toContain("drop");
    expect(kinds[kinds.length - 1]).toBe("posted");
  });

  it("the dispatch step reflects the PM's variable roster (4 specialists), not a fixed six", () => {
    const dispatch = DRIVEN_WORKING.transcript.find((s) => s.kind === "dispatch")!;
    expect(dispatch.text).toContain("4 specialists");
    expect(dispatch.detail).toContain("root-cause");
    expect(dispatch.detail).toContain("qa");
  });

  it("is held in a non-terminal state so the SSE route paces it live", () => {
    expect(DRIVEN_WORKING.state).toBe("fanning_out");
  });

  it("composed a PR from KEPT findings only — no dropped candidate leaks in", () => {
    expect(DRIVEN_WORKING.pr).not.toBeNull();
    // lines 42 (f-sec-1) and 51 (f-biz-1) are in the diff; line 88 (f-sec-2) is not.
    expect(DRIVEN_WORKING.pr!.comments.map((c) => c.findingId).sort()).toEqual(["f-biz-1", "f-sec-1"]);
  });

  it("getLiveSampleContainer resolves its own id and nothing else", () => {
    expect(getLiveSampleContainer(LIVE_WORKING_ID)).toBe(DRIVEN_WORKING);
    expect(getLiveSampleContainer("not-a-container")).toBeNull();
  });
});

describe("live-drive transport: the SSE producer streams the engine output in order", () => {
  it("emits every generated step in order, then done", () => {
    const store = new InMemoryContainerStore([DRIVEN_WORKING], 0); // 0ms = deterministic, no timers
    const streamed: SynthStep[] = [];
    let done = false;

    store.subscribe(
      DRIVEN_WORKING.id,
      (s) => streamed.push(s),
      () => {
        done = true;
      },
    );

    expect(done).toBe(true);
    expect(streamed).toEqual(DRIVEN_WORKING.transcript);
    expect(streamed[streamed.length - 1].kind).toBe("posted");
  });
});
