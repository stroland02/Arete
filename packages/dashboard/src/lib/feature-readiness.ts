import type { ReadinessLevel } from "@/components/ui/readiness-badge";

/**
 * The build-status inventory: every product surface and capability, with how
 * finished it actually is. This is the data behind /build-status.
 *
 * Deliberately hand-authored, not derived. `lib/overview-setup.ts` answers "has
 * this *user* finished onboarding" from live DB facts; this answers "has the
 * *team* finished building it", which no runtime signal can tell us. Keeping it
 * static also lets it honestly describe capabilities that have no UI to
 * inspect — the whole point of the exercise.
 *
 * Source: docs/status/2026-07-22-build-status-map.md (two parallel audits —
 * every control classified against its handler, every backend capability
 * checked for a UI caller). Update both together.
 */

export type ReadinessArea =
  | "Product surfaces"
  | "Built, but unreachable"
  | "Partially wired"
  | "Not built yet";

export interface FeatureReadiness {
  /** What it is, in the user's words. */
  name: string;
  area: ReadinessArea;
  level: ReadinessLevel;
  /** Where it lives, if it is reachable at all. */
  href?: string;
  /** What is genuinely real today. */
  works?: string;
  /** What is missing — the honest gap. Omitted when nothing is missing. */
  gap?: string;
  /** file:line proof, so a reader can check any claim. */
  evidence?: string;
}

export const FEATURE_READINESS: FeatureReadiness[] = [
  // ---------------------------------------------------------------- surfaces
  {
    name: "AI model connections",
    area: "Product surfaces",
    level: "live",
    href: "/connections/ai-models",
    works:
      "Connect, reconnect, set-active, disconnect and remove key. Ollama auto-detect with streamed model pull. Real diagnostics on failure.",
  },
  {
    name: "Review history",
    area: "Product surfaces",
    level: "live",
    href: "/history",
    works: "Server-filtered risk tabs, real review rows, pagination, honest empty state.",
  },
  {
    name: "Incidents list",
    area: "Product surfaces",
    level: "live",
    href: "/incidents",
    works:
      "Open / Resolved / Noise / All tabs over real incidents. New investigation creates a real Incident row.",
  },
  {
    name: "Settings & billing",
    area: "Product surfaces",
    level: "live",
    href: "/settings",
    works:
      "GitHub OAuth connect, real billing usage against the free-tier limit. No self-serve upgrade — stated plainly rather than faked.",
  },
  {
    name: "Overview",
    area: "Product surfaces",
    level: "partial",
    href: "/overview",
    works:
      "Stat tiles, Sensorium code map, setup checklist derived from real DB facts, preset tabs, time range.",
    gap: "Two checklist sub-steps (coding-agent setup prompt, MCP Kuma) are not built. Planned telemetry connectors are inert.",
    evidence: "lib/overview-setup.ts:83,106",
  },
  {
    name: "Agents",
    area: "Product surfaces",
    level: "partial",
    href: "/agents",
    works:
      "Per-agent chat is genuinely live against the connected model, with provider errors surfaced honestly. Findings come from real reviews.",
    gap: "Every configuration control is local-only and never saved. Approve-solution is effectively unreachable — nothing links to /agents?container=.",
    evidence: "agent-config-drawer.tsx:245, pr-panel.tsx:122-133",
  },
  {
    name: "Services",
    area: "Product surfaces",
    level: "partial",
    href: "/services",
    works:
      "Repo rail, live synthesizer console over SSE, status board, Scan, Fix it and Dismiss all hit real endpoints.",
    gap: "The whole PR-send workflow is stubbed or unreachable: Fix & open PR is disabled, and SendPrButton can never render with a real container.",
    evidence: "services-workspace.tsx:851-861, send-pr-button.tsx",
  },
  {
    name: "Incident detail",
    area: "Product surfaces",
    level: "partial",
    href: "/incidents",
    works:
      "Mark and unmark noise, view a linked fix run, scrubbed alert payload tables — and opening an investigation now starts a fix drive, the same way a critical alert does.",
    gap: "The fix run it starts still halts at the human approve-and-send gate, which has no screen yet (see Approval gate below).",
    evidence: "lib/incidents.ts, lib/fix-dispatch.ts",
  },
  {
    name: "Data connectors",
    area: "Product surfaces",
    level: "partial",
    href: "/connections",
    works: "GitHub App install, Stripe API key, and PostHog + Vercel OAuth.",
    gap: "Every other connector is disabled pending its integration being published.",
    evidence: "connections/[id]/page.tsx:117-123",
  },
  {
    name: "Search & notifications",
    area: "Product surfaces",
    level: "soon",
    works: "Nothing — the breadcrumb is the only working part of the top bar.",
    gap: "Command palette and notifications are both disabled placeholders.",
    evidence: "topbar.tsx:44-62",
  },

  // ------------------------------------------------------ built, but no UI
  {
    name: "Approval gate (human-in-the-loop)",
    area: "Built, but unreachable",
    level: "soon",
    works:
      "Complete end to end: the approval record, the claim-and-enqueue handler, a running worker, and the apply call into the agents service.",
    gap: "No screen anywhere lists pending approvals, so the product's headline safety feature is invisible. Belongs on review detail.",
    evidence: "worker.ts:439, schema.prisma:336-350",
  },
  {
    name: "Outbound webhooks",
    area: "Built, but unreachable",
    level: "soon",
    works:
      "Signing, retry backoff, SSRF-guarded delivery and a delivery log — it already fires on every persisted review, and the management API is now mounted behind session auth (list, register, enable/disable).",
    gap: "No Settings screen calls it yet, so registering a destination still needs a direct API call. Note for whoever builds it: the whsec_ signing secret is returned exactly once, on create — no route can read it back, so the UI must show it once and say so.",
    evidence: "webhook-endpoints-api.ts, api/webhooks/endpoints/route.ts, outbound/management.ts",
  },
  {
    name: "Agent memory",
    area: "Built, but unreachable",
    level: "soon",
    works:
      "Kuma really does record what it learns per repository and injects it into later reviews — and at the 20-row cap it now archives the oldest instead of refusing to learn.",
    gap: "Nothing displays it. There is no screen for what Kuma has learned about a repository, or for retiring a memory that has gone stale.",
    evidence: "memory-write.ts",
  },
  {
    name: "Live throughput metrics",
    area: "Built, but unreachable",
    level: "soon",
    works: "The worker publishes review-lifecycle metrics to a server-sent stream.",
    gap: "No consumer. The source comments call it a dark wire.",
    evidence: "agent-metrics.ts:4",
  },
  {
    name: "Webhook delivery retries",
    area: "Partially wired",
    level: "partial",
    works:
      "The retry worker now runs. A failed delivery is re-attempted on an exponential backoff and rescheduled — verified against real Postgres (attempts 1→2, nextAttempt advanced). Poll rate is set by OUTBOUND_RETRY_INTERVAL_MS.",
    gap: "Nothing surfaces delivery health: nobody can see that a delivery failed, how many attempts remain, or the last error. That needs the webhook endpoints UI.",
    evidence: "retry-worker.ts startOutboundRetryWorker, worker.ts",
  },

  // -------------------------------------------------------- partially wired
  {
    name: "Tracing & log search",
    area: "Partially wired",
    level: "partial",
    works: "Full OpenTelemetry instrumentation now flows into ClickHouse and Jaeger.",
    gap: "Exactly one metric reaches the UI. No trace view, no span drill-down, no log search, no deep link from a review or incident.",
    evidence: "lib/queries.ts:781-815",
  },
  {
    name: "Finding confidence",
    area: "Partially wired",
    level: "partial",
    works: "Confidence is computed and shown on scan and fix work items.",
    gap: "Pull-request findings have no confidence column at all, so reviews show none.",
    evidence: "schema.prisma (ReviewComment)",
  },
  {
    name: "Noise & escalation controls",
    area: "Partially wired",
    level: "partial",
    works:
      "A full state machine exists — silenced, under observation, escalated — with occurrence thresholds.",
    gap: "The dashboard only filters on open findings. No human can silence or un-silence anything.",
    evidence: "persistence.ts:162-200",
  },
  {
    name: "Telemetry freshness",
    area: "Partially wired",
    level: "partial",
    href: "/grid",
    works: "The grid reads a real telemetry snapshot per repository.",
    gap: "Snapshots are only captured during a review, and there is no background poller — a quiet repo shows arbitrarily stale data.",
    evidence: "schema.prisma:367-374",
  },
  {
    name: "MCP servers",
    area: "Partially wired",
    level: "partial",
    works: "Kuma can consume third-party MCP servers, driven from the CLI.",
    gap: "No dashboard surface to add or list them, and tokens are stored as plaintext JSON on disk.",
    evidence: "arete_agents/mcp/manager.py",
  },

  // ------------------------------------------------------------ not built
  {
    name: "Slack / Linear / PagerDuty relays",
    area: "Not built yet",
    level: "soon",
    gap: "Blocked on outbound webhook management and the retry worker. Once those land, each relay is a thin consumer.",
  },
  {
    name: "Public API & API keys",
    area: "Not built yet",
    level: "soon",
    gap: "No key issuance, no read or management REST surface.",
  },
  {
    name: "Review scope filters",
    area: "Not built yet",
    level: "soon",
    gap: "No way to say which paths Kuma should or should not review.",
  },
  {
    name: "Kuma as an MCP server",
    area: "Not built yet",
    level: "soon",
    gap: "Exposing Kuma's findings back into your coding agent. Only the client half exists today.",
  },
  {
    name: "Tenant telemetry ingestion",
    area: "Not built yet",
    level: "soon",
    gap: "Ingest endpoints, ingest keys, alert rules and a service map. Deliberately deferred — the current stack observes Kuma itself, not your services.",
  },
];

export const READINESS_AREAS: ReadinessArea[] = [
  "Product surfaces",
  "Built, but unreachable",
  "Partially wired",
  "Not built yet",
];

/** Counts by level, for the summary row. */
export function readinessTotals(
  features: FeatureReadiness[] = FEATURE_READINESS
): Record<ReadinessLevel, number> {
  return features.reduce<Record<ReadinessLevel, number>>(
    (acc, f) => ({ ...acc, [f.level]: (acc[f.level] ?? 0) + 1 }),
    { live: 0, preview: 0, partial: 0, soon: 0 }
  );
}
