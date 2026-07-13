/**
 * The hybrid verification brain — deterministic gate + LLM Critic.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §1, §5.3.
 *
 * Two stages, and their ORDER is the trust guarantee:
 *   ① gate   — keep iff file:line ∈ diff (pure, isEvidencedByDiff). Provable.
 *   ② Critic — a separate model reasons about each GATE-PASSED finding and may
 *              only UPHOLD, DROP, or FLAG it. It is never consulted about a
 *              gate-failed finding, so it can never resurrect one.
 *
 * Invariant, structural (not merely tested): kept ⊆ gatePassed ⊆ candidates.
 * A model hallucination can at worst drop a real finding (a surfaced miss),
 * never invent a fake one (a forbidden fabrication).
 *
 * `verifyHybrid` is a pure orchestration that takes the Critic as a parameter
 * (dependency injection) so it is deterministic and testable; the live model
 * call (`criticReview`) is wired in the connector session.
 */

import type { Diff, EvidenceRow, Finding, SynthStep } from "./types";
import { isEvidencedByDiff } from "./pipeline";

export interface CriticVerdict {
  verdict: "uphold" | "drop";
  rationale: string;
  confidence: number; // 0..1
}

/** The Critic's shape — a separate model judging one gate-passed finding. */
export type CriticFn = (finding: Finding, diff: Diff, evidence: EvidenceRow[]) => Promise<CriticVerdict>;

export interface HybridVerifyResult {
  findings: Finding[]; // every candidate resolved to kept | dropped
  transcript: SynthStep[];
  kept: number;
  dropped: number;
  gatePassed: number;
}

/** Below this Critic confidence a kept finding is flagged "wants a human look". */
export const DEFAULT_LOW_CONFIDENCE = 0.7;

function isoNow(): string {
  return new Date().toISOString();
}

export async function verifyHybrid(
  candidates: ReadonlyArray<Finding>,
  diff: Diff,
  critic: CriticFn,
  opts: { evidence?: EvidenceRow[]; lowConfidence?: number; now?: () => string } = {},
): Promise<HybridVerifyResult> {
  const now = opts.now ?? isoNow;
  const lowConfidence = opts.lowConfidence ?? DEFAULT_LOW_CONFIDENCE;
  const evidence = opts.evidence ?? [];

  const findings: Finding[] = [];
  const transcript: SynthStep[] = [];
  let kept = 0;
  let dropped = 0;
  let gatePassed = 0;

  for (const c of candidates) {
    transcript.push({
      kind: "verify",
      findingId: c.id,
      agentId: c.agentId,
      text: `Verifying ${c.category} · ${c.file}:${c.line}`,
      at: now(),
    });

    // ① Gate. A gate-failed finding is dropped and NEVER reaches the Critic.
    if (!isEvidencedByDiff(c, diff)) {
      const reason = `no evidence in the diff at ${c.file}:${c.line}`;
      findings.push({ ...c, verdict: "dropped", droppedReason: reason });
      transcript.push({ kind: "drop", findingId: c.id, agentId: c.agentId, text: "Dropped — unproven", detail: reason, at: now() });
      dropped++;
      continue;
    }
    gatePassed++;

    // ② Critic — only ever consulted for gate-passed findings.
    let v: CriticVerdict;
    try {
      v = await critic(c, diff, evidence);
    } catch {
      // Fail-open (spec §5.3): the gate already proved this real, so KEEP it and
      // flag for a human. A Critic outage degrades to the gate — never to a
      // silent drop of a real finding, never to a fabrication.
      findings.push({ ...c, verdict: "kept", droppedReason: undefined });
      transcript.push({ kind: "keep", findingId: c.id, agentId: c.agentId, text: "Kept — Critic unavailable, verify manually", detail: `${c.file}:${c.line}`, at: now(), needsAttention: true });
      kept++;
      continue;
    }

    if (v.verdict === "drop") {
      findings.push({ ...c, verdict: "dropped", droppedReason: v.rationale });
      transcript.push({ kind: "drop", findingId: c.id, agentId: c.agentId, text: "Dropped — Critic overruled", detail: v.rationale, at: now() });
      dropped++;
      continue;
    }

    // uphold → kept; low confidence flags "wants a human look".
    const flag = v.confidence < lowConfidence;
    findings.push({ ...c, verdict: "kept", droppedReason: undefined, confidence: v.confidence });
    transcript.push({
      kind: "keep",
      findingId: c.id,
      agentId: c.agentId,
      text: flag ? "Kept — wants a human look" : "Kept — evidence in the diff",
      detail: flag ? `${v.rationale} (confidence ${v.confidence.toFixed(2)})` : `${c.file}:${c.line}`,
      at: now(),
      needsAttention: flag,
    });
    kept++;
  }

  return { findings, transcript, kept, dropped, gatePassed };
}

/** Build a deterministic Critic from a fixture map (findingId → verdict) for tests/fixtures. */
export function makeFixtureCritic(map: Record<string, CriticVerdict>, fallback?: CriticVerdict): CriticFn {
  return async (finding) => {
    const v = map[finding.id] ?? fallback;
    if (!v) throw new Error(`no fixture verdict for finding ${finding.id}`);
    return v;
  };
}
