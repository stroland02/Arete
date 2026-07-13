import { describe, it, expect } from "vitest";
import type { SynthStep } from "@/lib/issue-pipeline/types";
import { stepVisual, shouldAnimate } from "./synth-transcript-visual";

const step = (over: Partial<SynthStep>): SynthStep => ({ kind: "verify", text: "t", at: "2026-07-13T00:00:00Z", ...over });

describe("shouldAnimate (live-only + reduced motion)", () => {
  it("animates only while working and motion is allowed", () => {
    expect(shouldAnimate("working", false)).toBe(true);
  });
  it("never animates under reduced motion", () => {
    expect(shouldAnimate("working", true)).toBe(false);
  });
  it("never animates when not working", () => {
    for (const p of ["idle", "ready", "done", "dismissed"] as const) {
      expect(shouldAnimate(p, false)).toBe(false);
    }
  });
});

describe("stepVisual", () => {
  it("shows a spinner on the last verify line only while animating", () => {
    expect(stepVisual(step({ kind: "verify" }), { isLast: true, animate: true }).showSpinner).toBe(true);
    expect(stepVisual(step({ kind: "verify" }), { isLast: false, animate: true }).showSpinner).toBe(false);
  });

  it("shows NO spinner under reduced motion / finished stream (final state)", () => {
    // animate=false is what a reduced-motion or done stream passes.
    expect(stepVisual(step({ kind: "verify" }), { isLast: true, animate: false }).showSpinner).toBe(false);
  });

  it("marks a kept finding success, and a flagged kept finding as attention", () => {
    const kept = stepVisual(step({ kind: "keep" }), { isLast: false, animate: false });
    expect(kept.tone).toBe("success");
    expect(kept.needsAttention).toBe(false);

    const flagged = stepVisual(step({ kind: "keep", needsAttention: true }), { isLast: false, animate: false });
    expect(flagged.tone).toBe("attention");
    expect(flagged.needsAttention).toBe(true);
    expect(flagged.marker).toBe("⚑");
  });

  it("drops render muted, posted renders success", () => {
    expect(stepVisual(step({ kind: "drop" }), { isLast: false, animate: false }).tone).toBe("muted");
    expect(stepVisual(step({ kind: "posted" }), { isLast: true, animate: false }).tone).toBe("success");
  });
});
