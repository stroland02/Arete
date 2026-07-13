/**
 * Issue Container & PR pipeline — pure domain logic.
 * See docs/superpowers/specs/2026-07-13-issue-container-and-pr-pipeline.md.
 *
 * Everything here is a pure function of its inputs (no I/O, no clock except an
 * injectable `now`), so it is deterministic, replayable, and testable — the
 * integrity/QA requirements of spec §5. The backend adapters (ingestion,
 * host API calls, DB persistence) call into these; they are added later.
 */

import type {
  ContainerState,
  Diff,
  Finding,
  IssueContainer,
  NormalizedEvent,
  PullRequest,
  SynthStep,
} from "./types";

function isoNow(): string {
  return new Date().toISOString();
}

// ── Fingerprint / dedupe (spec §4.2) ────────────────────────────────────────

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Deterministic dedupe key: same error signature in the same service → same key. */
export function fingerprint(evt: Pick<NormalizedEvent, "service" | "errorType" | "topFrame">): string {
  return [norm(evt.service), norm(evt.errorType), norm(evt.topFrame)].join("::");
}

/**
 * Route a new event to an existing container by fingerprint, scoped to the
 * installation (tenancy). Returns the container id, or null if it's new.
 * This is what makes ingestion idempotent at the issue level (spec §4.2, §5).
 */
export function findContainerByFingerprint(
  containers: ReadonlyArray<Pick<IssueContainer, "id" | "fingerprint" | "installationId">>,
  installationId: string,
  fp: string,
): string | null {
  const hit = containers.find((c) => c.installationId === installationId && c.fingerprint === fp);
  return hit ? hit.id : null;
}

// ── Verification (spec §4.5 + the §5 no-fabrication invariant) ───────────────

/** A finding is evidenced iff its exact file:line is among the PR's changed lines. */
export function isEvidencedByDiff(finding: Pick<Finding, "file" | "line">, diff: Diff): boolean {
  return diff.some((cl) => cl.file === finding.file && cl.line === finding.line);
}

export interface VerifyResult {
  findings: Finding[]; // each candidate resolved to kept | dropped
  transcript: SynthStep[];
  kept: number;
  dropped: number;
}

/**
 * The Synthesizer's verification pass: check every candidate against the diff,
 * keep only what's evidenced, drop the rest with a reason, and emit the ordered
 * transcript the "thinking" console renders. Pure — same inputs, same output.
 */
export function verifyAll(candidates: ReadonlyArray<Finding>, diff: Diff, now: () => string = isoNow): VerifyResult {
  const findings: Finding[] = [];
  const transcript: SynthStep[] = [];
  let kept = 0;
  let dropped = 0;

  for (const c of candidates) {
    transcript.push({
      kind: "verify",
      findingId: c.id,
      agentId: c.agentId,
      text: `Verifying ${c.category} · ${c.file}:${c.line}`,
      at: now(),
    });

    if (isEvidencedByDiff(c, diff)) {
      findings.push({ ...c, verdict: "kept", droppedReason: undefined });
      transcript.push({
        kind: "keep",
        findingId: c.id,
        agentId: c.agentId,
        text: "Kept — evidence in the diff",
        detail: `${c.file}:${c.line}`,
        at: now(),
      });
      kept++;
    } else {
      const reason = `no evidence in the diff at ${c.file}:${c.line}`;
      findings.push({ ...c, verdict: "dropped", droppedReason: reason });
      transcript.push({
        kind: "drop",
        findingId: c.id,
        agentId: c.agentId,
        text: "Dropped — unproven",
        detail: reason,
        at: now(),
      });
      dropped++;
    }
  }

  return { findings, transcript, kept, dropped };
}

/** Runtime + test guard: no kept finding may lack real evidence in the diff (spec §5). */
export function assertNoFabrication(findings: ReadonlyArray<Finding>, diff: Diff): void {
  for (const f of findings) {
    if (f.verdict === "kept" && !isEvidencedByDiff(f, diff)) {
      throw new Error(`fabrication: kept finding ${f.id} has no evidence in the diff`);
    }
  }
}

// ── State machine + gates (spec §4, §5) ─────────────────────────────────────

const TRANSITIONS: Record<ContainerState, ReadonlyArray<ContainerState>> = {
  detecting: ["fanning_out", "dismissed"],
  fanning_out: ["verifying", "dismissed"],
  verifying: ["composing", "dismissed"],
  composing: ["ready", "dismissed"],
  ready: ["solution_approved", "dismissed"],
  solution_approved: ["posted", "changes_requested", "dismissed"],
  changes_requested: ["fanning_out", "dismissed"],
  posted: ["merged", "dismissed"],
  merged: [],
  dismissed: [],
};

export function canTransition(from: ContainerState, to: ContainerState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Apply a transition, rejecting illegal moves (the state machine is enforced, not implied). */
export function transition(container: IssueContainer, to: ContainerState, now: () => string = isoNow): IssueContainer {
  if (!canTransition(container.state, to)) {
    throw new Error(`illegal transition: ${container.state} -> ${to}`);
  }
  return { ...container, state: to, updatedAt: now() };
}

/**
 * The send gate (spec §1, §4.8): a PR may only be posted from a container that
 * has cleared the Agents-page solution gate. Enforced server-side, not just UI.
 */
export function canPost(container: IssueContainer): boolean {
  return container.state === "solution_approved" && container.gates.solutionApprovedAt !== null;
}

// ── PR composition (spec §4.6 + the §3 comment↔kept invariant) ──────────────

function buildBody(kept: ReadonlyArray<Finding>): string {
  const byCategory = kept.reduce<Record<string, number>>((m, f) => {
    m[f.category] = (m[f.category] ?? 0) + 1;
    return m;
  }, {});
  const lines = Object.entries(byCategory).map(([cat, n]) => `- ${cat}: ${n}`);
  return [`Areté verified ${kept.length} finding(s) against this diff.`, "", ...lines].join("\n");
}

/**
 * Compose the PR review from a container's KEPT findings only — one comment per
 * kept finding, none for dropped ones. Produces a `ready` PR (still un-posted).
 */
export function composePr(
  container: Pick<IssueContainer, "findings">,
  opts: { base: string; branch: string },
): PullRequest {
  const kept = container.findings.filter((f) => f.verdict === "kept");
  const comments = kept.map((f) => ({
    findingId: f.id,
    file: f.file,
    line: f.line,
    body: `**${f.category}**: ${f.rationale}`,
  }));
  return {
    number: null,
    base: opts.base,
    branch: opts.branch,
    title: `Areté review — ${kept.length} verified finding${kept.length === 1 ? "" : "s"}`,
    body: buildBody(kept),
    comments,
    state: "ready",
    hostUrl: null,
  };
}

/** Every PR comment must trace to a KEPT finding — the auditability invariant (spec §3, §5). */
export function assertPrIntegrity(pr: Pick<PullRequest, "comments">, findings: ReadonlyArray<Finding>): void {
  const keptIds = new Set(findings.filter((f) => f.verdict === "kept").map((f) => f.id));
  for (const c of pr.comments) {
    if (!keptIds.has(c.findingId)) {
      throw new Error(`integrity: PR comment references non-kept finding ${c.findingId}`);
    }
  }
}
