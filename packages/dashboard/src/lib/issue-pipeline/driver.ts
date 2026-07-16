/**
 * Live Fix-workflow driver — the pure advance-engine (Wave-2 ②).
 * See docs/superpowers/specs/2026-07-15-kuma-work-floor-orchestration-design.md
 * and 2026-07-13-issue-container-and-pr-pipeline.md.
 *
 * This is the producer half of the Fix workflow: given a PM-distributor
 * DispatchPlan (from @arete/orchestration — the canonical star-topology model,
 * PM ruling Q1), the specialists' candidate findings, the diff, and the QA/
 * UI-validation pass results, it advances an IssueContainer
 * `detecting -> fanning_out -> verifying -> composing -> ready` and emits the
 * ordered SynthSteps the Agents-chat console + Services Synthesizer render over
 * the existing SSE stream (init -> step* -> done).
 *
 * It reuses — never re-invents — two proven layers:
 *   • @arete/orchestration for the PM⇄specialist model: `planToTasks` derives the
 *     dispatched roster, `advanceQaLoop` drives the bounded QA retry/escalation.
 *   • ./pipeline for verification + composition + the enforced state machine:
 *     `verifyAll` (keep/drop against the diff), `composePr`, `transition`.
 *
 * Purity: a function of its inputs (only `now` is injected), so it is
 * deterministic and replayable — the integrity/QA requirement of the pipeline
 * spec §5. No new SynthStep kinds are introduced: the console renderer is owned
 * elsewhere and must keep working unchanged.
 *
 * Model boundary (honest, not fabricated): the QA loop here folds a caller-
 * supplied sequence of QA results — it emits the PM re-dispatch step on each
 * failure and stops at synthesize/escalate. Actually re-running a specialist and
 * re-verifying per failed pass is the live harness's job (Phase B, the Python
 * driver); this core owns the loop *control* and the transcript, not the harness.
 */

import type { DispatchPlan, QaResult } from "@arete/orchestration";
import { advanceQaLoop, planToTasks, DEFAULT_MAX_PASSES } from "@arete/orchestration";
import type { Diff, Finding, IssueContainer, SynthStep } from "./types";
import { composePr, transition, verifyAll } from "./pipeline";

function isoNow(): string {
  return new Date().toISOString();
}

/** One dispatched specialist's report back to the PM — its candidate findings. */
export interface SpecialistReport {
  agentId: string; // provenance; == Finding.category / the packages/agents name
  label: string; // display name, e.g. "Security"
  candidates: Finding[];
}

export interface DriveInput {
  /** Must be in `detecting` — the state machine is enforced, not assumed. */
  container: IssueContainer;
  /** The PM-distributor's analysis + variable specialist roster. */
  plan: DispatchPlan;
  /** What each dispatched specialist reported. */
  reports: SpecialistReport[];
  /** The changed lines a "kept" finding must be evidenced by. */
  diff: Diff;
  /** Ordered QA/UI-validation results; omit/empty to skip the QA gate. */
  qaResults?: QaResult[];
  /** Bounds the QA retry loop (design §2.5). Defaults to DEFAULT_MAX_PASSES. */
  maxPasses?: number;
  /** Base + branch for the composed PR. */
  compose: { base: string; branch: string };
  now?: () => string;
}

export type DriveOutcome = "ready" | "escalated";

export interface DriveResult {
  /** The advanced container: `ready` on success, `verifying` on escalation. */
  container: IssueContainer;
  /** The steps produced this run, in order (also appended to the transcript). */
  steps: SynthStep[];
  kept: number;
  dropped: number;
  outcome: DriveOutcome;
  /** Set iff outcome === "escalated": why QA handed back to the human. */
  escalationReason?: string;
}

/**
 * Drive one problem through the work floor. Pure: same inputs → same output.
 */
export function driveContainer(input: DriveInput): DriveResult {
  const now = input.now ?? isoNow;
  if (input.container.state !== "detecting") {
    throw new Error(`driveContainer expects a detecting container, got ${input.container.state}`);
  }

  const steps: SynthStep[] = [];
  let container = input.container;

  // 1. PM-distributor analyzes + dispatches the plan (detecting -> fanning_out).
  //    The roster is variable — derived from the plan, not a fixed six.
  const tasks = planToTasks(input.plan);
  const roster = input.plan.assignments.map((a) => a.specialty).join(" · ");
  steps.push({
    kind: "dispatch",
    text: `${tasks.length} specialist${tasks.length === 1 ? "" : "s"} dispatched by the PM`,
    detail: `${input.plan.analysis} — ${roster}`,
    at: now(),
  });
  container = transition(container, "fanning_out", now);

  // 2. Specialists report their candidates (fanning_out).
  const candidates: Finding[] = [];
  for (const r of input.reports) {
    const n = r.candidates.length;
    steps.push({
      kind: "report",
      agentId: r.agentId,
      text: `${r.label} reported ${n} candidate${n === 1 ? "" : "s"}`,
      at: now(),
    });
    candidates.push(...r.candidates);
  }

  // 3. Synthesizer verifies every candidate against the diff (-> verifying).
  container = transition(container, "verifying", now);
  const v = verifyAll(candidates, input.diff, now);
  steps.push(...v.transcript);

  // 4. QA/UI-validation loop (design §2.5): pass -> synthesize; fail -> PM
  //    re-dispatch bounded by maxPasses; exhaustion -> escalate to the human gate.
  const qaResults = input.qaResults ?? [];
  const maxPasses = input.maxPasses ?? DEFAULT_MAX_PASSES;
  let qaState = { passes: 0, maxPasses };
  let escalationReason: string | null = null;
  for (const result of qaResults) {
    const advanced = advanceQaLoop(qaState, result);
    qaState = advanced.state;
    const outcome = advanced.outcome;
    if (outcome.action === "synthesize") break;
    if (outcome.action === "redispatch") {
      steps.push({
        kind: "dispatch",
        text: "QA failed — re-dispatching to the fix author",
        detail: outcome.error,
        at: now(),
      });
      continue;
    }
    // escalate-human: hand back rather than loop (kills the no-termination mode).
    escalationReason = outcome.reason;
    break;
  }

  if (escalationReason !== null) {
    const escalated: IssueContainer = {
      ...container,
      findings: v.findings,
      transcript: [...input.container.transcript, ...steps],
      updatedAt: now(),
    };
    return { container: escalated, steps, kept: v.kept, dropped: v.dropped, outcome: "escalated", escalationReason };
  }

  // 5. Synthesize: compose the PR from KEPT findings, then raise the ready gate
  //    (verifying -> composing -> ready).
  const withFindings: IssueContainer = { ...container, findings: v.findings };
  container = transition(withFindings, "composing", now);
  steps.push({
    kind: "compose",
    text: `Composing review — ${v.kept} comment${v.kept === 1 ? "" : "s"}`,
    at: now(),
  });
  const pr = composePr(withFindings, input.compose);
  container = transition(container, "ready", now);
  steps.push({ kind: "posted", text: "Review composed — ready for your approval", at: now() });

  const ready: IssueContainer = {
    ...container,
    pr,
    transcript: [...input.container.transcript, ...steps],
    updatedAt: now(),
  };
  return { container: ready, steps, kept: v.kept, dropped: v.dropped, outcome: "ready" };
}
