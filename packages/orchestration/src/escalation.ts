// Deterministic escalation ladder (spec §3). No LLM judgment; threshold is a
// PARAMETER (dashboard passes critic.DEFAULT_LOW_CONFIDENCE) so this package
// stays dependency-free. Rule 3 of the spec (synth cannot compose → human) is
// the driver's existing `escalated` outcome — not re-modeled here.
import type { StatusReport } from "./status-report.js";

export type EscalationTier = "none" | "synth" | "human";

export function escalationTier(report: StatusReport, lowConfidenceThreshold: number): EscalationTier {
  if (report.status === "escalating") return "human";
  if (report.status === "blocked" || report.status === "needs_input") return "synth";
  if (report.confidence < lowConfidenceThreshold) return "synth";
  return "none";
}
