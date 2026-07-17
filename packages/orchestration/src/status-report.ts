// The specialist→PM "tiered-meeting update" (Fabriq-formalized star-topology,
// spec 2026-07-16-tiered-comms-design.md §2). Distinct from ./status.ts, which
// models the HUMAN fleet's status contract. Pure types + validator; no IO.

export const REVIEW_DIMENSIONS = [
  "security",
  "performance",
  "quality",
  "test_coverage",
  "deployment_safety",
  "business_logic",
] as const;
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];

export function isReviewDimension(x: string): x is ReviewDimension {
  return (REVIEW_DIMENSIONS as readonly string[]).includes(x);
}

export const SPECIALIST_STATUSES = [
  "on_track",
  "blocked",
  "needs_input",
  "escalating",
  "done",
] as const;
export type SpecialistStatus = (typeof SPECIALIST_STATUSES)[number];

export interface StatusReport {
  agent: string;
  dimension: ReviewDimension;
  status: SpecialistStatus;
  /** The single most-relevant line — never empty. */
  summary: string;
  /** REAL, from the agent/critic — never synthesized for display. In [0,1]. */
  confidence: number;
  /** Bottom-up "what I need" signal; may be empty. */
  blockers: string[];
}

export type StatusReportValidation =
  | { ok: true; value: StatusReport }
  | { ok: false; error: string };

export function validateStatusReport(input: unknown): StatusReportValidation {
  if (typeof input !== "object" || input === null) return { ok: false, error: "not an object" };
  const r = input as Record<string, unknown>;
  if (typeof r.agent !== "string" || r.agent === "") return { ok: false, error: "agent must be a non-empty string" };
  if (typeof r.dimension !== "string" || !isReviewDimension(r.dimension))
    return { ok: false, error: `unknown dimension: ${String(r.dimension)}` };
  if (typeof r.status !== "string" || !(SPECIALIST_STATUSES as readonly string[]).includes(r.status))
    return { ok: false, error: `unknown status: ${String(r.status)}` };
  if (typeof r.summary !== "string" || r.summary === "") return { ok: false, error: "summary must be a non-empty string" };
  if (typeof r.confidence !== "number" || !(r.confidence >= 0 && r.confidence <= 1))
    return { ok: false, error: "confidence must be a number in [0,1]" };
  if (!Array.isArray(r.blockers) || r.blockers.some((b) => typeof b !== "string"))
    return { ok: false, error: "blockers must be string[]" };
  return {
    ok: true,
    value: {
      agent: r.agent,
      dimension: r.dimension,
      status: r.status as SpecialistStatus,
      summary: r.summary,
      confidence: r.confidence,
      blockers: r.blockers as string[],
    },
  };
}
