/**
 * Issue Container & PR pipeline — domain types.
 * See docs/superpowers/specs/2026-07-13-issue-container-and-pr-pipeline.md §3.
 *
 * These are plain TS domain types (the in-memory / sample-provider first step,
 * spec §6.2) — NOT the Prisma schema. Mapping the container into @arete/db is a
 * separate, single-owner step (spec §6.1) and is intentionally not done here.
 */

export type Severity = "critical" | "high" | "medium";

export type ContainerState =
  | "detecting"
  | "fanning_out"
  | "verifying"
  | "composing"
  | "ready"
  | "solution_approved"
  | "posted"
  | "changes_requested"
  | "merged"
  | "dismissed";

export type Verdict = "candidate" | "kept" | "dropped";

/** A single line the PR actually changed — what "verified against the diff" checks against. */
export interface ChangedLine {
  file: string;
  line: number;
}
export type Diff = ChangedLine[];

export interface DiffRow {
  kind: "context" | "add" | "remove";
  text: string;
}

export interface Finding {
  id: string;
  agentId: string; // provenance: which specialist raised it
  category: string; // == agent_name in packages/agents/*.py
  file: string;
  line: number; // WHERE — must reference the diff for "kept"
  rationale: string;
  diff: DiffRow[];
  verdict: Verdict;
  droppedReason?: string; // required iff verdict === "dropped"
  evidenceRef?: string;
  confidence?: number;
}

export interface SynthStep {
  kind: "dispatch" | "report" | "verify" | "keep" | "drop" | "compose" | "posted";
  findingId?: string;
  agentId?: string;
  text: string;
  detail?: string;
  at: string; // ISO timestamp
  /**
   * Set on a `keep` step the Critic flagged low-confidence (spec
   * synthesizer-component-and-critic §2, §4): gate-passed and kept, but "wants
   * a human look". Renders as the ⚑ variant and increments the ledger's
   * needs-attention count. Optional + backward-compatible.
   */
  needsAttention?: boolean;
}

export interface PrComment {
  findingId: string;
  file: string;
  line: number;
  body: string;
}

export interface PullRequest {
  number: number | null; // null until actually opened on the host
  base: string;
  branch: string;
  title: string;
  body: string;
  comments: PrComment[];
  state: "drafting" | "composing" | "ready" | "posted" | "changes_requested" | "merged";
  hostUrl: string | null;
}

export interface EvidenceRow {
  key: string;
  value: string;
}

/** A telemetry/PR event after per-connector normalization (spec §4.1). */
export interface NormalizedEvent {
  provider: string; // sentry | vercel | stripe | ci | posthog | arete
  providerEventId: string; // for idempotent ingest
  service: string;
  errorType: string;
  topFrame: string;
  severity: Severity;
  at: string;
}

export interface ContainerGates {
  solutionApprovedAt: string | null;
  solutionApprovedBy: string | null;
  postedAt: string | null;
  postedBy: string | null;
}

export interface IssueContainer {
  id: string;
  installationId: string; // tenancy scope — every query filters on this
  serviceId: string;
  fingerprint: string; // dedupe key (spec §4.2)
  source: string;
  severity: Severity;
  state: ContainerState;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  evidence: EvidenceRow[];
  findings: Finding[];
  transcript: SynthStep[];
  pr: PullRequest | null;
  gates: ContainerGates;
  createdAt: string;
  updatedAt: string;
}
