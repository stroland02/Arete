// The uniform status contract as a state machine:
//   (initial) → scope-confirmed → progress ⇄ blockers → done
// Structurally counters MAST failure categories 1 (spec/design: scope-confirmed
// forces explicit scope) and 3 (verification: `done` requires evidence — green
// tests alone are insufficient, per the team-workflow gate rule).

export type StatusPhase = "scope-confirmed" | "progress" | "blockers" | "done";

export interface Verification {
  /** full test matrix green */
  matrix: boolean;
  /** actually exercised the real affected flow, not just build-green */
  droveRealFlow: boolean;
  evidence: string;
}

export interface StatusReport {
  phase: StatusPhase;
  note: string;
  /** required to enter "done" */
  verification?: Verification;
}

export type TransitionResult =
  | { ok: true; phase: StatusPhase }
  | { ok: false; reason: string };

export const TERMINAL_PHASE: StatusPhase = "done";

// Keyed by the *current* phase ("null" = no report yet).
const ALLOWED: Record<string, StatusPhase[]> = {
  null: ["scope-confirmed"],
  "scope-confirmed": ["progress", "blockers"],
  progress: ["progress", "blockers", "done"],
  blockers: ["progress", "blockers", "done"],
  done: [],
};

export function transition(from: StatusPhase | null, report: StatusReport): TransitionResult {
  const allowed = ALLOWED[from ?? "null"] ?? [];
  if (!allowed.includes(report.phase)) {
    return { ok: false, reason: `illegal transition ${from ?? "(initial)"} -> ${report.phase}` };
  }
  if (report.phase === "done") {
    const v = report.verification;
    if (!v || !v.matrix || !v.droveRealFlow) {
      return { ok: false, reason: "done requires verification: matrix green AND drove the real flow" };
    }
  }
  return { ok: true, phase: report.phase };
}
