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
  /**
   * How much this matters, independent of how finished it is. P0 = the product
   * is not trustworthy or sellable while this is open. Optional so entries
   * written before priorities existed stay valid.
   */
  priority?: Priority;
  /** Which development phase owns it — drives the progression strip. */
  phase?: Phase;
  /** Audit id from docs/status/2026-07-22-build-status-map.md, e.g. "A5", "B8". */
  ref?: string;
  /**
   * Set when a claim needs re-checking against current main — never corrected
   * automatically. Says what to re-check, so a human resolves it with evidence
   * rather than trusting a guess.
   */
  needsVerification?: string;
}

/** Importance bands, most important first. */
export type Priority = "P0" | "P1" | "P2" | "P3";

/** Development phases, in order, matching docs/roadmap/backlog.md. */
export type Phase = "P1" | "P2" | "P2b" | "P3" | "P4";

export const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];

export const PRIORITY_LABELS: Record<Priority, string> = {
  P0: "Blocks trust",
  P1: "Next up",
  P2: "Planned",
  P3: "Someday",
};

export const PHASES: Phase[] = ["P1", "P2", "P2b", "P3", "P4"];

export const FEATURE_READINESS: FeatureReadiness[] = [
  // ---------------------------------------------------------------- surfaces
  {
    name: "AI model connections",
    phase: "P1",
    area: "Product surfaces",
    level: "live",
    href: "/connections/ai-models",
    works:
      "Connect, reconnect, set-active, disconnect and remove key. Ollama auto-detect with streamed model pull. Real diagnostics on failure.",
  },
  {
    name: "Review history",
    phase: "P1",
    area: "Product surfaces",
    level: "live",
    href: "/history",
    works: "Server-filtered risk tabs, real review rows, pagination, honest empty state.",
  },
  {
    name: "Incidents list",
    phase: "P1",
    area: "Product surfaces",
    level: "live",
    href: "/incidents",
    works:
      "Open / Resolved / Noise / All tabs over real incidents. New investigation creates a real Incident row.",
  },
  {
    name: "Settings & billing",
    phase: "P1",
    area: "Product surfaces",
    level: "live",
    href: "/settings",
    works:
      "GitHub OAuth connect, real billing usage against the free-tier limit. No self-serve upgrade — stated plainly rather than faked.",
  },
  {
    name: "Overview",
    priority: "P2",
    phase: "P2",
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
    priority: "P1",
    phase: "P2b",
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
    priority: "P1",
    phase: "P2b",
    needsVerification: "Commit 1192d37 claims the two HITL gates are now reachable — approve, then post the PR — which is exactly this row's gap. Re-check before planning off it; left unedited on purpose.",
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
    priority: "P1",
    phase: "P2b",
    ref: "B1",
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
    priority: "P2",
    phase: "P2",
    area: "Product surfaces",
    level: "partial",
    href: "/connections",
    works: "GitHub App install, Stripe API key, and PostHog + Vercel OAuth.",
    gap: "Every other connector is disabled pending its integration being published.",
    evidence: "connections/[id]/page.tsx:117-123",
  },
  {
    name: "Search & notifications",
    priority: "P3",
    phase: "P3",
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
    priority: "P1",
    phase: "P2b",
    ref: "A1",
    needsVerification:
      "Commits 1192d37 and a21f956 claim the HITL gates are now reachable and rejectable. Re-check whether this row's gap still holds before planning off it — left unedited on purpose.",
  },
  {
    name: "Outbound webhooks",
    priority: "P1",
    phase: "P2",
    ref: "A2",
    area: "Built, but unreachable",
    level: "soon",
    works:
      "Signing, retry backoff, SSRF-guarded delivery and a delivery log — it already fires on every persisted review, and the management API is now mounted behind session auth (list, register, enable/disable).",
    gap: "No Settings screen calls it yet, so registering a destination still needs a direct API call. Note for whoever builds it: the whsec_ signing secret is returned exactly once, on create — no route can read it back, so the UI must show it once and say so.",
    evidence: "webhook-endpoints-api.ts, api/webhooks/endpoints/route.ts, outbound/management.ts",
  },
  {
    name: "Agent memory",
    priority: "P1",
    phase: "P2b",
    ref: "A3",
    area: "Built, but unreachable",
    level: "soon",
    works:
      "Kuma really does record what it learns per repository and injects it into later reviews — and at the 20-row cap it now archives the oldest instead of refusing to learn.",
    gap: "Nothing displays it. There is no screen for what Kuma has learned about a repository, or for retiring a memory that has gone stale.",
    evidence: "memory-write.ts",
  },
  {
    name: "Live throughput metrics",
    priority: "P2",
    phase: "P2",
    ref: "A4",
    area: "Built, but unreachable",
    level: "soon",
    works: "The worker publishes review-lifecycle metrics to a server-sent stream.",
    gap: "No consumer. The source comments call it a dark wire.",
    evidence: "agent-metrics.ts:4",
  },
  {
    name: "Webhook delivery retries",
    priority: "P2",
    phase: "P2",
    ref: "A5",
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
    priority: "P1",
    phase: "P2b",
    ref: "B2",
    area: "Partially wired",
    level: "partial",
    works: "Full OpenTelemetry instrumentation now flows into ClickHouse and Jaeger.",
    gap: "Exactly one metric reaches the UI. No trace view, no span drill-down, no log search, no deep link from a review or incident.",
    evidence: "lib/queries.ts:781-815",
  },
  {
    name: "Finding confidence",
    priority: "P2",
    phase: "P2",
    ref: "B3",
    area: "Partially wired",
    level: "partial",
    works: "Confidence is computed and shown on scan and fix work items.",
    gap: "Pull-request findings have no confidence column at all, so reviews show none.",
    evidence: "schema.prisma (ReviewComment)",
  },
  {
    name: "Noise & escalation controls",
    priority: "P2",
    phase: "P2",
    ref: "B4",
    area: "Partially wired",
    level: "partial",
    works:
      "A full state machine exists — silenced, under observation, escalated — with occurrence thresholds.",
    gap: "The dashboard only filters on open findings. No human can silence or un-silence anything.",
    evidence: "persistence.ts:162-200",
  },
  {
    name: "Telemetry freshness",
    priority: "P2",
    phase: "P2",
    ref: "B5",
    area: "Partially wired",
    level: "partial",
    href: "/grid",
    works: "The grid reads a real telemetry snapshot per repository.",
    gap: "Snapshots are only captured during a review, and there is no background poller — a quiet repo shows arbitrarily stale data.",
    evidence: "schema.prisma:367-374",
  },
  {
    name: "MCP servers",
    priority: "P2",
    phase: "P2b",
    ref: "B6",
    area: "Partially wired",
    level: "partial",
    works:
      "Kuma can consume third-party MCP servers, driven from the CLI. OAuth tokens are encrypted at rest under ARETE_MCP_TOKEN_KEY, and the credential store is gitignored.",
    gap: "No dashboard surface to add or list them — connecting a server is still a CLI-only operation.",
    evidence: "arete_agents/mcp/manager.py, arete_agents/mcp/token_crypto.py",
  },

  // ------------------------------------------------------------ not built
  {
    name: "Slack / Linear / PagerDuty relays",
    priority: "P2",
    phase: "P2",
    ref: "C1",
    area: "Not built yet",
    level: "soon",
    gap: "Blocked on outbound webhook management and the retry worker. Once those land, each relay is a thin consumer.",
  },
  {
    name: "Public API & API keys",
    priority: "P3",
    phase: "P3",
    ref: "C2",
    area: "Not built yet",
    level: "soon",
    gap: "No key issuance, no read or management REST surface.",
  },
  {
    name: "Review scope filters",
    priority: "P2",
    phase: "P1",
    ref: "C3",
    area: "Not built yet",
    level: "soon",
    gap: "No way to say which paths Kuma should or should not review.",
  },
  {
    name: "Kuma as an MCP server",
    priority: "P3",
    phase: "P3",
    ref: "C4",
    area: "Not built yet",
    level: "soon",
    gap: "Exposing Kuma's findings back into your coding agent. Only the client half exists today.",
  },
  {
    name: "Tenant telemetry ingestion",
    priority: "P3",
    phase: "P4",
    ref: "C6",
    area: "Not built yet",
    level: "soon",
    gap: "Ingest endpoints, ingest keys, alert rules and a service map. Deliberately deferred — the current stack observes Kuma itself, not your services.",
  },

  // ------------------------------------------------------- appended 2026-07-22
  // Items that existed in docs/ or in a closed workspace's residuals but had no
  // row here. Added, never substituted for existing entries. Sources: the audit
  // (docs/status/2026-07-22-build-status-map.md), the backlog's Phase 2b list,
  // and docs/status/2026-07-14-build-wave-1-complete.md §4.
  {
    name: "Security agent returns fabricated results",
    area: "Partially wired",
    level: "partial",
    priority: "P0",
    phase: "P2b",
    ref: "B7",
    works: "The other five review agents return real, grounded findings.",
    gap: "SecurityAssessor returns simulated results, string-matched off the skill filename — the one live fabrication left in the agents package. Must not be surfaced in the UI until it is real.",
    evidence: "arete_agents/skills/security.py:12",
  },
  {
    name: "Internal API token never expires",
    area: "Partially wired",
    level: "partial",
    priority: "P0",
    phase: "P2b",
    ref: "B8",
    works: "Every internal route is authenticated with a shared secret.",
    gap: "One static token: no expiry, rotation or revocation — and expiry is not expressible in the current code path. It guards every write-and-spend route on both services. Resolve before adding proxies that depend on it.",
    evidence: "webhook/src/internal-auth.ts:43",
  },
  {
    name: "MCP tokens are plaintext, and the OAuth exchange is faked",
    area: "Partially wired",
    level: "partial",
    priority: "P0",
    phase: "P2b",
    ref: "B6/B8",
    works: "Kuma can consume third-party MCP servers.",
    gap: "Tokens persist as plaintext JSON with no expiry field and no file-mode hardening, and the auth step never performs a code exchange — it fabricates a token string, then presents it as a Bearer credential indefinitely.",
    evidence: "arete_agents/mcp/auth.py:90",
  },
  // B1 and A3 are deliberately NOT repeated here: "Incident detail" and "Agent
  // memory" above already own those defects and now carry the matching `ref`.
  // A second row per defect would double-count them in the phase totals.
  {
    name: "Reviews shown in the product are unverified in a browser",
    area: "Partially wired",
    level: "partial",
    priority: "P1",
    phase: "P2b",
    works: "The dashboard type-checks and builds clean, and every route compiles.",
    gap: "Authenticated routes have been build-verified, not driven. A green build is not proof: a duplicated landing section and dead placeholder cards once passed every build and were only caught in a browser.",
    evidence: "docs/status/2026-07-14-build-wave-1-complete.md",
  },
  {
    name: "Self-serve plan upgrade",
    area: "Not built yet",
    level: "soon",
    priority: "P1",
    phase: "P2b",
    gap: "Tier limits are enforced and the gate already returns tier, limit and remaining — but there is no Stripe Checkout-session endpoint, so nobody can upgrade themselves. Stated plainly on Settings rather than faked.",
    evidence: "webhook/src/billing.ts",
  },
  {
    name: "Fix pipeline has no tool loop",
    area: "Partially wired",
    level: "partial",
    priority: "P2",
    phase: "P2b",
    works: "Tool-calling works on the review side.",
    gap: "The fix pipeline makes one direct call for a JSON blob, so rubrics have to live in the prompt rather than in tool descriptions.",
    evidence: "arete_agents/fix_pipeline.py",
  },
  {
    name: "Fix failures that die before dispatch are uncounted",
    area: "Partially wired",
    level: "partial",
    priority: "P2",
    phase: "P2b",
    works: "Fix drives that reach the agents service are counted.",
    gap: "Failures terminating on the webhook side never appear in the counters, so a fix drive that dies before dispatch is invisible.",
    evidence: "webhook/src/worker.ts",
  },
  {
    name: "Credentials written in prose still reach sinks",
    area: "Partially wired",
    level: "partial",
    priority: "P2",
    phase: "P2b",
    works: "URL-embedded credentials are redacted, and the key blocklist catches structured secrets.",
    gap: "The blocklist binds to object keys, not words inside a string, so a secret written in prose passes through. Fixing it means amending a frozen pattern set with real false-positive risk.",
    evidence: "packages/telemetry (redaction patterns)",
  },
  {
    name: "Review PR links and resolution reasons",
    area: "Not built yet",
    level: "soon",
    priority: "P2",
    phase: "P1",
    ref: "C5",
    gap: "A review does not store the pull-request URL, and resolving or silencing a finding records no reason code.",
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

export interface PhaseProgress {
  phase: Phase;
  /** Items counted as finished — `live` is the only level that means done. */
  done: number;
  total: number;
}

/**
 * Progress per phase, so the page can show movement between phases rather than
 * a flat list. Only counts items that declare a phase; an unphased item is
 * deliberately absent rather than silently bucketed somewhere it doesn't belong.
 */
export function phaseProgress(
  features: FeatureReadiness[] = FEATURE_READINESS
): PhaseProgress[] {
  return PHASES.map((phase) => {
    const inPhase = features.filter((f) => f.phase === phase);
    return {
      phase,
      done: inPhase.filter((f) => f.level === "live").length,
      total: inPhase.length,
    };
  }).filter((p) => p.total > 0);
}

/**
 * Items in a priority band, most-unfinished first so the work to do reads
 * before the work already done. Items with no priority fall into `undefined`,
 * which the page renders last under "Unprioritised".
 */
export function byPriority(
  priority: Priority | undefined,
  features: FeatureReadiness[] = FEATURE_READINESS
): FeatureReadiness[] {
  const order: Record<ReadinessLevel, number> = { soon: 0, partial: 1, preview: 2, live: 3 };
  return features
    .filter((f) => f.priority === priority)
    .sort((a, b) => order[a.level] - order[b.level]);
}
