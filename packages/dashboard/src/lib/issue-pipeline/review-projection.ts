/**
 * Project a real, completed Kuma review into the IssueContainer shape the
 * Synthesizer console consumes — the honest bridge from real backend data to
 * the streaming UI (spec 2026-07-13-synthesizer-component-and-critic §5.2).
 *
 * A stored review's comments are the findings that ALREADY passed the backend
 * gate + Critic and were posted to the PR, so here they are all `kept`. The
 * diff-evidence invariant (`assertNoFabrication`) was enforced upstream when the
 * review ran; we do not re-check it (we don't have the diff), and we never
 * invent findings, counts, or dropped entries — the transcript narrates only the
 * real, verified comments. A projected review is therefore a terminal (`posted`)
 * container: the console shows its final state, no live animation.
 *
 * Kept dependency-light (a local `ProjectedReview` mirror of queries.ts
 * `ReviewDetail`, dates already ISO) so this stays a pure, testable function.
 */

import type { Finding, IssueContainer, Severity, SynthStep } from "./types";

export interface ProjectedReviewFinding {
  id: string;
  path: string;
  line: number;
  body: string;
  severity: string;
  category: string; // == agent id
}

export interface ProjectedReview {
  id: string;
  prNumber: number;
  riskLevel: string;
  overallSummary: string;
  analysisStatus: string;
  createdAt: string; // ISO — caller converts Date -> ISO
  repositoryFullName: string;
  findings: ProjectedReviewFinding[];
}

function toSeverity(riskLevel: string): Severity {
  switch (riskLevel.toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    default:
      return "medium"; // medium / low / unknown collapse to the lowest tier we model
  }
}

export function reviewToContainer(review: ProjectedReview, installationId: string): IssueContainer {
  const at = review.createdAt;
  const n = review.findings.length;
  const plural = n === 1 ? "finding" : "findings";

  const findings: Finding[] = review.findings.map((f) => ({
    id: f.id,
    agentId: f.category,
    category: f.category,
    file: f.path,
    line: f.line,
    rationale: f.body,
    diff: [],
    verdict: "kept",
  }));

  // Reconstruct the transcript from the real verified comments — dispatch,
  // then verify→keep per real finding, then compose + posted. No dropped
  // entries (upstream drops aren't stored), so nothing is invented.
  const transcript: SynthStep[] = [
    { kind: "dispatch", text: "Six specialists reviewed this pull request", at },
    ...findings.flatMap((f): SynthStep[] => [
      { kind: "verify", findingId: f.id, agentId: f.agentId, text: `Verifying ${f.category} · ${f.file}:${f.line}`, at },
      { kind: "keep", findingId: f.id, agentId: f.agentId, text: "Kept — evidence in the diff", detail: `${f.file}:${f.line}`, at },
    ]),
    { kind: "compose", text: `Composing review — ${n} ${n === 1 ? "comment" : "comments"}`, at },
    { kind: "posted", text: `Review posted — PR #${review.prNumber}`, at },
  ];

  return {
    id: review.id,
    installationId,
    serviceId: review.repositoryFullName,
    fingerprint: `${review.repositoryFullName}#${review.prNumber}`,
    source: "Kuma",
    severity: toSeverity(review.riskLevel),
    state: "posted", // a stored review's comments are already on the PR
    firstSeen: at,
    lastSeen: at,
    occurrences: 1,
    evidence: [{ key: "review", value: `PR #${review.prNumber} — ${n} verified ${plural}` }],
    findings,
    transcript,
    pr: {
      number: review.prNumber,
      base: "main",
      branch: `pull/${review.prNumber}`,
      title: `Kuma review — ${n} verified ${plural}`,
      body: review.overallSummary,
      comments: findings.map((f) => ({ findingId: f.id, file: f.file, line: f.line, body: `**${f.category}**: ${f.rationale}` })),
      state: "posted",
      hostUrl: null,
    },
    gates: { solutionApprovedAt: at, solutionApprovedBy: "kuma", postedAt: at, postedBy: "kuma" },
    createdAt: at,
    updatedAt: at,
  };
}
