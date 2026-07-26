import { describe, it, expect } from "vitest";
import { deriveOverviewSetup } from "./overview-setup";

// State-matrix test for the four-step honest setup narrative (Account-State
// Contract): connect an AI model → connect your codebase → build, deploy &
// verify → extend Kuma. Every `done` maps to a real DB fact; capabilities not
// yet shipped are `coming_soon` guidance — never a checkmark.

type Input = Parameters<typeof deriveOverviewSetup>[0];

const state = (over: Partial<Input> = {}): Input => ({
  repoConnected: false,
  modelConnected: false,
  hasReviews: false,
  scanCompleted: false,
  telemetryConnected: false,
  ...over,
});

describe("deriveOverviewSetup — the four-step setup matrix", () => {
  it("all empty → nothing done, next step is connect-model", () => {
    const s = deriveOverviewSetup(state());
    expect(s.steps).toHaveLength(4);
    expect(s.doneCount).toBe(0);
    expect(s.setupComplete).toBe(false);
    expect(s.nextStep?.id).toBe("connect-model");
  });

  it("pending model only (no repo yet) → step 1 done, next is connect-codebase", () => {
    const s = deriveOverviewSetup(state({ modelConnected: true }));
    expect(s.steps[0].done).toBe(true);
    expect(s.doneCount).toBe(1);
    expect(s.setupComplete).toBe(false);
    expect(s.nextStep?.id).toBe("connect-codebase");
  });

  it("repo + model connected, no scan or reviews → next is verify", () => {
    const s = deriveOverviewSetup(state({ repoConnected: true, modelConnected: true }));
    expect(s.steps[0].done).toBe(true);
    expect(s.steps[1].done).toBe(true);
    expect(s.steps[2].done).toBe(false);
    expect(s.setupComplete).toBe(false);
    expect(s.nextStep?.id).toBe("verify");
  });

  it("scanCompleted alone completes verify (first scan proves the pair works)", () => {
    const s = deriveOverviewSetup(
      state({ repoConnected: true, modelConnected: true, scanCompleted: true })
    );
    expect(s.steps[2].done).toBe(true);
    expect(s.setupComplete).toBe(true);
  });

  it("hasReviews alone completes verify (first PR review is the other real signal)", () => {
    const s = deriveOverviewSetup(
      state({ repoConnected: true, modelConnected: true, hasReviews: true })
    );
    expect(s.steps[2].done).toBe(true);
    expect(s.setupComplete).toBe(true);
  });

  it("workspace-setup and mcp-kuma graduated to actionable todo steps — real pages, never faked complete", () => {
    // These two were `coming_soon` guidance until the pages were built
    // (/connections/workspace-setup, /connections/mcp-kuma). Now they are real,
    // actionable `todo` steps with hrefs. The invariant they still uphold: their
    // status is static `todo` in EVERY account-state combination — no boolean
    // ever flips them to `done`, so an unfinished action is never faked complete.
    // (No `coming_soon` sub-steps remain in the matrix; the guidance-never-a-
    // checkmark rule re-arms automatically if one is added.)
    const graduatedIds = ["workspace-setup", "mcp-kuma"];
    const bools = [false, true];
    for (const repoConnected of bools)
      for (const modelConnected of bools)
        for (const hasReviews of bools)
          for (const scanCompleted of bools)
            for (const telemetryConnected of bools) {
              const s = deriveOverviewSetup({
                repoConnected,
                modelConnected,
                hasReviews,
                scanCompleted,
                telemetryConnected,
              });
              const rows = s.steps
                .flatMap((step) => step.subSteps ?? [])
                .filter((sub) => graduatedIds.includes(sub.id));
              expect(rows).toHaveLength(2);
              for (const sub of rows) {
                expect(sub.status).toBe("todo");
                expect(sub.href).toBeTruthy();
              }
            }
  });

  it("telemetryConnected toggles step 4 done without affecting setupComplete", () => {
    const core = { repoConnected: true, modelConnected: true, hasReviews: true };
    const off = deriveOverviewSetup(state(core));
    const on = deriveOverviewSetup(state({ ...core, telemetryConnected: true }));
    expect(off.steps[3].done).toBe(false);
    expect(on.steps[3].done).toBe(true);
    expect(off.setupComplete).toBe(true);
    expect(on.setupComplete).toBe(true);
    // Telemetry connected early never fakes setup progress on steps 1–3.
    const early = deriveOverviewSetup(state({ telemetryConnected: true }));
    expect(early.steps[3].done).toBe(true);
    expect(early.setupComplete).toBe(false);
    expect(early.nextStep?.id).toBe("connect-model");
  });

  it("setupComplete when steps 1–3 done even with step 4 todo; extend becomes the next step", () => {
    const s = deriveOverviewSetup(
      state({ repoConnected: true, modelConnected: true, hasReviews: true })
    );
    expect(s.setupComplete).toBe(true);
    expect(s.doneCount).toBe(3);
    expect(s.nextStep?.id).toBe("extend");
    // Everything done → no next step at all.
    const all = deriveOverviewSetup(
      state({
        repoConnected: true,
        modelConnected: true,
        hasReviews: true,
        telemetryConnected: true,
      })
    );
    expect(all.doneCount).toBe(4);
    expect(all.nextStep).toBeUndefined();
  });
});
