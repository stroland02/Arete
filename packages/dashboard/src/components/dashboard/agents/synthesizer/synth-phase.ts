/**
 * Synthesizer phase derivation — pure.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §4.
 *
 * Maps a container's authoritative `ContainerState` onto the console's visual
 * `SynthPhase` (which region animates, the progress fraction). Kept pure and
 * state-only so both the Agents console and the Services summary derive an
 * identical phase from the one source of truth — they can never disagree.
 */

import type { ContainerState } from "@/lib/issue-pipeline/types";

/** The console's visual phase — coarser than ContainerState, drives motion. */
export type SynthPhase = "idle" | "working" | "ready" | "done" | "dismissed";

const PHASE_BY_STATE: Record<ContainerState, SynthPhase> = {
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
  // A failed fix run is terminal and non-success — render its final state, no motion.
  fix_failed: "dismissed",
};

/** Progress toward a composed, ready PR — 0 at detection, 1 once ready or later. */
const PROGRESS_BY_STATE: Record<ContainerState, number> = {
  detecting: 0,
  fanning_out: 0.25,
  verifying: 0.5,
  composing: 0.75,
  ready: 1,
  solution_approved: 1,
  posted: 1,
  changes_requested: 1,
  merged: 1,
  dismissed: 0,
  fix_failed: 0,
};

export function phaseOf(state: ContainerState): SynthPhase {
  return PHASE_BY_STATE[state];
}

export function progressOf(state: ContainerState): number {
  return PROGRESS_BY_STATE[state];
}

/**
 * Live-only motion (spec §4): the console animates ONLY while actively solving.
 * A finished (or idle/dismissed) container renders its final state, no motion.
 */
export function isAnimating(state: ContainerState): boolean {
  return phaseOf(state) === "working";
}
