// The QA/UI-validation loop (design §2.5). After a candidate fix, QA drives the
// affected flow and returns pass/fail. Pass -> synthesize. Fail -> re-dispatch
// with the exact error, bounded by maxPasses; on exhaustion escalate to the human
// gate rather than loop (kills the MAST no-termination failure mode). Pure loop
// control — the caller owns the actual dispatch/harness (Phase B).

import type { Verification } from "./status.js";

export const DEFAULT_MAX_PASSES = 3;

export interface QaResult {
  pass: boolean;
  error?: string; // required-in-spirit when pass === false
}

export interface QaLoopState {
  passes: number; // fix attempts QA has already evaluated
  maxPasses: number;
}

export type QaOutcome =
  | { action: "synthesize" }
  | { action: "redispatch"; error: string }
  | { action: "escalate-human"; reason: string };

export function advanceQaLoop(
  state: QaLoopState,
  result: QaResult,
): { state: QaLoopState; outcome: QaOutcome } {
  if (result.pass) {
    return { state, outcome: { action: "synthesize" } };
  }
  const passes = state.passes + 1;
  const next = { ...state, passes };
  const error = result.error ?? "QA reported a failure without detail";
  if (passes >= state.maxPasses) {
    return {
      state: next,
      outcome: {
        action: "escalate-human",
        reason: `QA still failing after ${passes} pass(es): ${error}`,
      },
    };
  }
  return { state: next, outcome: { action: "redispatch", error } };
}

/** A QA pass IS the "drove the real flow" evidence the status machine's `done`
 *  gate requires; to reach QA the review/test specialists already ran, so the
 *  matrix is green as well (design §2.5, §7). */
export function qaVerification(evidence: string): Verification {
  return { matrix: true, droveRealFlow: true, evidence };
}
