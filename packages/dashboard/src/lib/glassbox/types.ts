/**
 * Glass Box — live dogfooding cockpit event envelope.
 * Design: docs/superpowers/specs/2026-07-15-glass-box-cockpit-design.md §3.2.
 *
 * ONE typed envelope every producer maps into (git watcher, BullMQ bridge, and
 * later the agents/webhook emitters). The dashboard only ever consumes this
 * shape over SSE — it never talks to Redis/BullMQ/git directly. Keeping the
 * envelope here (not in the sidecar) lets narrate() + the feed be unit-tested
 * without any infra.
 */

export type GlassBoxSource = "git" | "queue" | "agent" | "review" | "build" | "system";

export type GlassBoxSeverity = "info" | "success" | "warn" | "error";

/** Typed deep-link hooks — all optional; what makes an event actionable in the UI. */
export interface GlassBoxRefs {
  branch?: string;
  sha?: string;
  files?: string[];
  jobId?: string;
  queue?: string;
  reviewId?: string;
  agentId?: string;
  node?: string;
  repoRoot?: string;
}

export interface GlassBoxEvent {
  /** Monotonic id — also the SSE `id:` / Last-Event-ID for resume. */
  id: string;
  /** ISO 8601 timestamp. */
  at: string;
  source: GlassBoxSource;
  /** Dotted kind, e.g. "git.commit" | "queue.review.completed" | "system.hello". */
  kind: string;
  /** One-line, already human-readable without the UI knowing the source. */
  title: string;
  /** Expandable body (commit subjects, span attrs, drop reason…). */
  detail?: string;
  refs?: GlassBoxRefs;
  severity?: GlassBoxSeverity;
}
