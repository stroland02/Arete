/**
 * The Services workspace's shared data contract.
 *
 * These types are consumed by the workspace orchestration, by every panel it
 * renders, and by the diff surface (`diff-view.tsx` / `diff-stat.ts`). They
 * live in their own module so the panels can import them without importing
 * `services-workspace.tsx` itself — which imports the panels, and would make
 * the graph circular. `services-workspace.tsx` re-exports every name here, so
 * the original `import type { DiffRow } from "./services-workspace"` path
 * still resolves.
 *
 * NOTE these describe the SAMPLE/marketing shape (a scripted `Issue` with a
 * hand-written timeline), not the real review contract — that is
 * `ServiceReviewGroup`/`ServiceReviewRow` in `@/lib/queries` and `WorkItemView`
 * in `@/lib/work-items`.
 */

export type Severity = "critical" | "high" | "medium";

export interface DiffRow {
  kind: "context" | "add" | "remove";
  text: string;
}

export interface Issue {
  id: string;
  serviceId: string;
  source: string; // Sentry | Stripe | CI | Vercel | PostHog | Kuma
  severity: Severity;
  status: string;
  agent: string;
  title: string;
  occurrences: string;
  lastSeen: string;
  where: string; // file:line
  summary: string;
  evidence: { file: string; rows: Array<[string, string]> };
  fix: { file: string; rows: DiffRow[] };
  timeline: Array<{ tone: Severity | "good" | "accent"; text: string; when: string }>;
}

export interface Service {
  id: string;
  open: number;
  worst: Severity | "clear";
}
