import type { ComponentType, CSSProperties } from "react";
import {
  IconBriefcase,
  IconGauge,
  IconRocket,
  IconShieldCheck,
  IconSparkles,
  IconTestPipe,
} from "@tabler/icons-react";

export type AgentIcon = ComponentType<{
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
}>;

export type AgentTier = "opus" | "sonnet";

export interface Agent {
  /**
   * Exact `agent_name` string the matching specialist in
   * packages/agents/src/arete_agents/agents/*.py writes onto every
   * ReviewComment — which is why `commentsByCategory` counts map 1:1 onto
   * these cards. The id *is* the category.
   */
  id: string;
  label: string;
  /** One-liner shown on the card. */
  description: string;
  /** Fuller explanation shown in the config drawer. */
  longDescription: string;
  /** What this agent actually looks at — shown as a list in the drawer. */
  inspects: string[];
  /**
   * Model tier from packages/agents/src/arete_agents/config.py defaults
   * (opus = claude-opus-4-8, sonnet = claude-sonnet-5). Server config today —
   * displayed honestly, not per-tenant editable yet.
   */
  tier: AgentTier;
  icon: AgentIcon;
}

/**
 * The six main-grid specialists. ci_diagnostics is deliberately absent: it
 * only runs in place of these six when a CI log needs diagnosing, and the
 * Synthesizer is the hourglass — a coordinator, not a card.
 */
export const AGENTS: Agent[] = [
  {
    id: "security",
    label: "Security",
    description: "Scans the diff for vulnerabilities and OWASP-class issues.",
    longDescription:
      "Reads every changed line looking for injection points, authentication and authorization gaps, unsafe crypto, and leaked secrets. Findings map to OWASP-class issues so you can triage by real severity.",
    inspects: [
      "Injection & unsafe input handling",
      "AuthN / AuthZ changes",
      "Secrets & credential exposure",
      "Crypto & dependency usage",
    ],
    tier: "opus",
    icon: IconShieldCheck,
  },
  {
    id: "performance",
    label: "Performance",
    description: "Flags algorithmic and resource-usage regressions in the diff.",
    longDescription:
      "Estimates the runtime cost of the change — algorithmic complexity shifts, N+1 query patterns, and memory pressure that won't show up until production load.",
    inspects: [
      "Algorithmic complexity shifts",
      "Database query patterns",
      "Memory & allocation pressure",
      "Hot-path code changes",
    ],
    tier: "sonnet",
    icon: IconGauge,
  },
  {
    id: "quality",
    label: "Quality",
    description: "Reviews style, readability, and maintainability of the changes.",
    longDescription:
      "Reviews the diff the way a careful senior engineer would — naming, structure, duplication, and dead code — flagging maintainability debt before it compounds.",
    inspects: [
      "Naming & readability",
      "Structure & duplication",
      "Dead or unreachable code",
      "API surface clarity",
    ],
    tier: "sonnet",
    icon: IconSparkles,
  },
  {
    id: "test_coverage",
    label: "Test Coverage",
    description: "Checks whether the diff's behavior changes are actually tested.",
    longDescription:
      "Compares the behavior the diff changes against the tests it ships with, flagging changed logic no test exercises and assertions that no longer prove anything.",
    inspects: [
      "Untested behavior changes",
      "Assertion strength",
      "Edge & error paths",
      "Test-to-diff mapping",
    ],
    tier: "sonnet",
    icon: IconTestPipe,
  },
  {
    id: "deployment_safety",
    label: "Deployment Safety",
    description: "Looks for migration, rollout, and config risks in the diff.",
    longDescription:
      "Looks at what happens when this change actually ships — schema migrations, config and environment changes, rollout ordering, and anything that could make a rollback unsafe.",
    inspects: [
      "Schema migrations",
      "Config & environment changes",
      "Rollout / rollback ordering",
      "Feature-flag wiring",
    ],
    tier: "opus",
    icon: IconRocket,
  },
  {
    id: "business_logic",
    label: "Business Logic",
    description:
      "Checks the diff against your connected production signals — the only agent that reads telemetry.",
    longDescription:
      "Cross-references the diff with your connected production telemetry — errors, deploys, payments, analytics — to catch changes that contradict how the system actually behaves in production.",
    inspects: [
      "Domain rules vs. real behavior",
      "Production telemetry signals",
      "Revenue-critical paths",
      "Contract & invariant drift",
    ],
    tier: "opus",
    icon: IconBriefcase,
  },
];
