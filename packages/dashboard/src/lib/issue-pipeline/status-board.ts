// Situational-awareness board projection (spec §4): a pure fold over the
// existing SynthStep stream — one row per specialist, latest report wins.
// No new transport; the SSE route already carries these steps.
import { escalationTier, type EscalationTier, type ReviewDimension, type SpecialistStatus } from "@arete/orchestration";
import { DEFAULT_LOW_CONFIDENCE } from "./critic";
import type { SynthStep } from "./types";

export interface BoardRow {
  agentId: string;
  dimension: ReviewDimension;
  status: SpecialistStatus;
  confidence: number;
  topBlocker: string | null;
  escalatedTo: EscalationTier;
  at: string;
}

export function projectStatusBoard(steps: SynthStep[]): BoardRow[] {
  const rows = new Map<string, BoardRow>();
  for (const s of steps) {
    if (!s.report) continue;
    const r = s.report;
    rows.set(r.agent, {
      agentId: r.agent,
      dimension: r.dimension,
      status: r.status,
      confidence: r.confidence,
      topBlocker: r.blockers[0] ?? null,
      escalatedTo: escalationTier(r, DEFAULT_LOW_CONFIDENCE),
      at: s.at,
    });
  }
  return [...rows.values()];
}
