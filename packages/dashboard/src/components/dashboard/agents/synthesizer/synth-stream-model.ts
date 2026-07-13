/**
 * Synthesizer stream model — pure reducer + view derivation.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §2, §4.
 *
 * The SSE hook (`use-synth-stream.ts`) is a thin EventSource adapter over these
 * pure functions; all the ordering, counting, and phase logic lives here so it
 * is unit-testable without a browser EventSource. The container snapshot arrives
 * as `init`; each `step` appends in order; `done` closes. Counts and the
 * effective phase are derived from the STREAM (not from init.findings) so the
 * ledger climbs live as verdicts arrive.
 */

import type { IssueContainer, PullRequest, SynthStep } from "@/lib/issue-pipeline/types";
import { phaseOf, progressOf, type SynthPhase } from "./synth-phase";

export interface SynthStreamState {
  container: IssueContainer | null;
  steps: SynthStep[];
  done: boolean;
  error: string | null;
}

export type SynthStreamEvent =
  | { type: "init"; container: IssueContainer }
  | { type: "step"; step: SynthStep }
  | { type: "done" }
  | { type: "error"; message: string };

export const initialSynthStreamState: SynthStreamState = {
  container: null,
  steps: [],
  done: false,
  error: null,
};

export function synthStreamReducer(state: SynthStreamState, event: SynthStreamEvent): SynthStreamState {
  switch (event.type) {
    case "init":
      return { ...state, container: event.container };
    case "step":
      // Append-only, preserving arrival order (the transcript IS ordered).
      return { ...state, steps: [...state.steps, event.step] };
    case "done":
      return { ...state, done: true };
    case "error":
      return { ...state, error: event.message, done: true };
    default:
      return state;
  }
}

export interface SynthView {
  phase: SynthPhase;
  progress: number;
  steps: SynthStep[];
  /** Distinct agent ids that have reported candidates, in first-seen order. */
  reportedAgentIds: string[];
  prState: PullRequest["state"] | null;
  kept: number;
  dropped: number;
  needsAttention: number;
  /** True once the composed PR awaits a human — raises the approval card. */
  ready: boolean;
  done: boolean;
  error: string | null;
}

/**
 * Effective phase: for a live (non-terminal) container the STREAM drives it —
 * "working" until the composing/posted step, then "ready". For a terminal
 * container the authoritative container.state governs (spec §4).
 */
export function effectivePhase(state: SynthStreamState): SynthPhase {
  if (!state.container) return "idle";
  const baseline = phaseOf(state.container.state);
  if (baseline === "done" || baseline === "dismissed" || baseline === "ready") return baseline;
  if (state.steps.some((s) => s.kind === "posted")) return "ready";
  if (state.steps.length > 0) return "working";
  return baseline;
}

export function deriveSynthView(state: SynthStreamState): SynthView {
  const steps = state.steps;
  const kept = steps.filter((s) => s.kind === "keep").length;
  const dropped = steps.filter((s) => s.kind === "drop").length;
  const needsAttention = steps.filter((s) => s.kind === "keep" && s.needsAttention === true).length;

  const reportedAgentIds: string[] = [];
  for (const s of steps) {
    if (s.kind === "report" && s.agentId && !reportedAgentIds.includes(s.agentId)) {
      reportedAgentIds.push(s.agentId);
    }
  }

  const phase = effectivePhase(state);
  const progress = state.container ? progressOf(state.container.state) : 0;

  return {
    phase,
    progress,
    steps,
    reportedAgentIds,
    prState: state.container?.pr?.state ?? null,
    kept,
    dropped,
    needsAttention,
    ready: phase === "ready",
    done: state.done,
    error: state.error,
  };
}
