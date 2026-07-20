import { describe, it, expect } from "vitest";
import type { ContainerState } from "@/lib/issue-pipeline/types";
import { phaseOf, progressOf, isAnimating, type SynthPhase } from "./synth-phase";

const ALL_STATES: ContainerState[] = [
  "detecting",
  "fanning_out",
  "verifying",
  "composing",
  "ready",
  "solution_approved",
  "posted",
  "changes_requested",
  "merged",
  "dismissed",
  "fix_failed",
];

describe("phaseOf", () => {
  it("maps each container state to the expected phase", () => {
    const expected: Record<ContainerState, SynthPhase> = {
      detecting: "idle",
      fanning_out: "working",
      verifying: "working",
      composing: "working",
      ready: "ready",
      solution_approved: "done",
      posted: "done",
      changes_requested: "done",
      merged: "done",
      dismissed: "dismissed",
      fix_failed: "dismissed",
    };
    for (const s of ALL_STATES) expect(phaseOf(s)).toBe(expected[s]);
  });

  it("returns a defined phase for every state (no gaps)", () => {
    for (const s of ALL_STATES) expect(phaseOf(s)).toBeTypeOf("string");
  });
});

describe("progressOf", () => {
  it("increases monotonically through the solving pipeline", () => {
    expect(progressOf("detecting")).toBeLessThan(progressOf("fanning_out"));
    expect(progressOf("fanning_out")).toBeLessThan(progressOf("verifying"));
    expect(progressOf("verifying")).toBeLessThan(progressOf("composing"));
    expect(progressOf("composing")).toBeLessThan(progressOf("ready"));
  });

  it("is 1 once ready and stays 1 through terminal states", () => {
    for (const s of ["ready", "solution_approved", "posted", "changes_requested", "merged"] as ContainerState[]) {
      expect(progressOf(s)).toBe(1);
    }
  });

  it("stays within [0,1] for every state", () => {
    for (const s of ALL_STATES) {
      expect(progressOf(s)).toBeGreaterThanOrEqual(0);
      expect(progressOf(s)).toBeLessThanOrEqual(1);
    }
  });
});

describe("isAnimating (live-only)", () => {
  it("animates only while actively solving", () => {
    expect(isAnimating("fanning_out")).toBe(true);
    expect(isAnimating("verifying")).toBe(true);
    expect(isAnimating("composing")).toBe(true);
  });

  it("does not animate when idle, ready, done, or dismissed", () => {
    for (const s of ["detecting", "ready", "solution_approved", "posted", "merged", "dismissed"] as ContainerState[]) {
      expect(isAnimating(s)).toBe(false);
    }
  });
});
