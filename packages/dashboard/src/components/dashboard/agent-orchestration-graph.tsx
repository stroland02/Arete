"use client";

import { useId, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  IconBriefcase,
  IconGauge,
  IconGitPullRequest,
  IconPlugConnected,
  IconRocket,
  IconShieldCheck,
  IconSparkles,
  IconTerminal2,
  IconTestPipe,
  IconTopologyStar3,
} from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CategoryCount } from "@/lib/queries";

type AgentIcon = React.ComponentType<{
  size?: number;
  stroke?: number;
  style?: React.CSSProperties;
}>;

/**
 * Every entry here corresponds 1:1 to a real specialist agent in
 * packages/agents/src/arete_agents/agents/*.py — `category` is the exact
 * string each agent's `agent_name` property returns, which the LLM is
 * instructed to write onto every ReviewComment it produces (see base.py's
 * prompt template). This is why `commentsByCategory` can drive real node
 * sizing: the category *is* the agent, not a loose label.
 */
const AGENT_DEFS: Array<{
  category: string;
  label: string;
  description: string;
  icon: AgentIcon;
  /** Only rendered when data for it actually exists (CI-log review mode). */
  conditional?: boolean;
}> = [
  {
    category: "security",
    label: "Security",
    description: "Scans the diff for vulnerabilities and OWASP-class issues.",
    icon: IconShieldCheck,
  },
  {
    category: "performance",
    label: "Performance",
    description: "Flags algorithmic and resource-usage regressions in the diff.",
    icon: IconGauge,
  },
  {
    category: "quality",
    label: "Quality",
    description: "Reviews style, readability, and maintainability of the changes.",
    icon: IconSparkles,
  },
  {
    category: "test_coverage",
    label: "Test Coverage",
    description: "Checks whether the diff's behavior changes are actually tested.",
    icon: IconTestPipe,
  },
  {
    category: "deployment_safety",
    label: "Deployment Safety",
    description: "Looks for migration, rollout, and config risks in the diff.",
    icon: IconRocket,
  },
  {
    category: "business_logic",
    label: "Business Logic",
    description:
      "Checks the diff against your connected production signals — the only agent that reads telemetry.",
    icon: IconBriefcase,
  },
  {
    category: "ci_diagnostics",
    label: "CI Diagnostics",
    description: "Ran in place of the 6 specialists this cycle to diagnose a failing CI log.",
    icon: IconTerminal2,
    conditional: true,
  },
];

const TELEMETRY_LABELS: Record<string, string> = {
  sentry: "Sentry",
  vercel: "Vercel",
  stripe: "Stripe",
  posthog: "PostHog",
  github_actions: "GitHub Actions",
};

function telemetryLabel(provider: string): string {
  return TELEMETRY_LABELS[provider] ?? provider;
}

interface LaidOutNode {
  id: string;
  label: string;
  description: string;
  icon: AgentIcon;
  x: number;
  y: number;
  r: number;
  count: number;
  active: boolean;
  pulseDelay: number;
  pulseDuration: number;
}

const COLUMN_X = 56;
const HUB_X = 246;
const OUTCOME_X = 380;
const TOP_Y = 34;
const ROW_GAP = 44;
const MIN_R = 15;
const MAX_EXTRA_R = 11;

interface AgentOrchestrationGraphProps {
  totalPrs: number;
  commentsByCategory: CategoryCount[];
  telemetryProviders: string[];
}

export function AgentOrchestrationGraph({
  totalPrs,
  commentsByCategory,
  telemetryProviders,
}: AgentOrchestrationGraphProps) {
  const reducedMotion = useReducedMotion();
  const uid = useId();
  const dotGridId = `${uid}-dot-grid`;
  const glowId = `${uid}-node-glow`;

  const countByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of commentsByCategory) map.set(c.category, c.count);
    return map;
  }, [commentsByCategory]);

  const visibleAgents = useMemo(
    () => AGENT_DEFS.filter((def) => !def.conditional || (countByCategory.get(def.category) ?? 0) > 0),
    [countByCategory]
  );

  const totalFindings = commentsByCategory.reduce((sum, c) => sum + c.count, 0);
  const hasData = totalPrs > 0;
  const animated = hasData && !reducedMotion;

  const nodes: LaidOutNode[] = useMemo(() => {
    return visibleAgents.map((def, i) => {
      const count = countByCategory.get(def.category) ?? 0;
      const share = totalFindings > 0 ? count / totalFindings : 0;
      return {
        id: def.category,
        label: def.label,
        description: def.description,
        icon: def.icon,
        x: COLUMN_X,
        y: TOP_Y + i * ROW_GAP,
        r: MIN_R + Math.sqrt(share) * MAX_EXTRA_R,
        count,
        active: count > 0,
        pulseDelay: i * 0.35,
        pulseDuration: 2.4 + (i % 3) * 0.3,
      };
    });
  }, [visibleAgents, countByCategory, totalFindings]);

  const hubY = TOP_Y + ((visibleAgents.length - 1) * ROW_GAP) / 2;
  const businessLogicNode = nodes.find((n) => n.id === "business_logic");
  const svgHeight = TOP_Y * 2 + Math.max(0, visibleAgents.length - 1) * ROW_GAP;

  const statusDetail = hasData
    ? `${totalFindings} recent finding${totalFindings === 1 ? "" : "s"} across ${visibleAgents.length} agent${visibleAgents.length === 1 ? "" : "s"}`
    : "no reviews yet — connect a repository to see this light up";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col border border-border-subtle rounded-xl bg-content-primary/[0.02] backdrop-blur-sm overflow-hidden">
        <div className="min-h-72 flex items-center justify-center py-6">
          <svg
            viewBox={`0 0 440 ${svgHeight}`}
            className="w-full h-full max-w-2xl"
            role="img"
            aria-label={`Agent orchestration graph: ${visibleAgents.map((a) => a.label).join(", ")} feed the Synthesizer, which posts verified findings to your pull request`}
          >
            <defs>
              <pattern id={dotGridId} width={20} height={20} patternUnits="userSpaceOnUse">
                <circle cx={1.5} cy={1.5} r={1} fill="rgba(255,255,255,0.04)" />
              </pattern>
              <filter id={glowId} x="-75%" y="-75%" width="250%" height="250%">
                <feGaussianBlur stdDeviation={8} />
              </filter>
            </defs>

            <rect width={440} height={svgHeight} fill={`url(#${dotGridId})`} />

            {/* Agent → Synthesizer edges */}
            {nodes.map((node) => {
              const d = `M ${node.x + node.r},${node.y} C ${(node.x + HUB_X) / 2},${node.y} ${(node.x + HUB_X) / 2},${hubY} ${HUB_X - 28},${hubY}`;
              return (
                <g key={`edge-${node.id}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={node.active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)"}
                    strokeWidth={1.5}
                  />
                  {animated && node.active && (
                    <motion.circle
                      r={2.5}
                      fill="var(--color-accent-primary)"
                      style={{ offsetPath: `path('${d}')` }}
                      initial={{ offsetDistance: "0%", opacity: 0 }}
                      animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
                      transition={{
                        duration: node.pulseDuration,
                        delay: node.pulseDelay,
                        repeat: Infinity,
                        ease: "easeInOut",
                        opacity: { duration: node.pulseDuration, delay: node.pulseDelay, repeat: Infinity, times: [0, 0.15, 0.8, 1], ease: "linear" },
                      }}
                    />
                  )}
                </g>
              );
            })}

            {/* Synthesizer → outcome edge */}
            <path
              d={`M ${HUB_X + 26},${hubY} L ${OUTCOME_X - 24},${hubY}`}
              fill="none"
              stroke={hasData ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)"}
              strokeWidth={1.5}
            />
            {animated && (
              <motion.circle
                r={3}
                fill="var(--color-accent-success)"
                style={{ offsetPath: `path('M ${HUB_X + 26},${hubY} L ${OUTCOME_X - 24},${hubY}')` }}
                initial={{ offsetDistance: "0%", opacity: 0 }}
                animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", opacity: { duration: 1.8, repeat: Infinity, times: [0, 0.15, 0.8, 1], ease: "linear" } }}
              />
            )}

            {/* Telemetry sources → Business Logic edge (only what's really connected) */}
            {businessLogicNode && telemetryProviders.length > 0 && (
              <g>
                <path
                  d={`M 8,${businessLogicNode.y - 30} C 24,${businessLogicNode.y - 30} 24,${businessLogicNode.y} ${businessLogicNode.x - businessLogicNode.r},${businessLogicNode.y}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth={1.25}
                  strokeDasharray="2 4"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <g className="cursor-pointer">
                      <circle cx={8} cy={businessLogicNode.y - 30} r={10} fill="rgba(255,255,255,0.04)" stroke="var(--color-accent-info)" strokeOpacity={0.8} strokeWidth={1.25} />
                      <foreignObject x={-2} y={businessLogicNode.y - 40} width={20} height={20} className="pointer-events-none">
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-accent-info)" }}>
                          <IconPlugConnected size={12} stroke={1.75} />
                        </div>
                      </foreignObject>
                    </g>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {telemetryProviders.length} connected source{telemetryProviders.length === 1 ? "" : "s"}: {telemetryProviders.map(telemetryLabel).join(", ")}
                  </TooltipContent>
                </Tooltip>
              </g>
            )}

            {/* Agent nodes */}
            {nodes.map((node) => {
              const Icon = node.icon;
              const pulseTransition = { duration: node.pulseDuration, delay: node.pulseDelay, repeat: Infinity, ease: "easeInOut" as const };
              return (
                <Tooltip key={node.id}>
                  <TooltipTrigger asChild>
                    <g className="cursor-pointer">
                      {node.active && (
                        <motion.circle
                          cx={node.x}
                          cy={node.y}
                          r={node.r + 10}
                          fill="var(--color-accent-primary)"
                          filter={`url(#${glowId})`}
                          className="pointer-events-none"
                          animate={animated ? { opacity: [0.08, 0.2, 0.08] } : { opacity: 0.14 }}
                          transition={animated ? pulseTransition : undefined}
                        />
                      )}
                      <motion.circle
                        cx={node.x}
                        cy={node.y}
                        r={node.r}
                        fill="rgba(255,255,255,0.04)"
                        stroke={node.active ? "var(--color-accent-primary)" : "var(--color-content-muted)"}
                        strokeOpacity={node.active ? 0.9 : 0.3}
                        strokeWidth={1.5}
                        animate={animated ? { opacity: [0.75, 1, 0.75] } : { opacity: node.active ? 1 : 0.5 }}
                        transition={animated ? pulseTransition : undefined}
                      />
                      <foreignObject x={node.x - 12} y={node.y - 12} width={24} height={24} className="pointer-events-none">
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: node.active ? "var(--color-accent-primary)" : "var(--color-content-muted)", opacity: node.active ? 0.95 : 0.55 }}>
                          <Icon size={16} stroke={1.75} />
                        </div>
                      </foreignObject>
                      <text x={node.x} y={node.y + node.r + 14} textAnchor="middle" className="fill-content-muted text-[10px] font-medium">
                        {node.label}
                      </text>
                    </g>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {node.description} {node.count > 0 ? `— ${node.count} recent finding${node.count === 1 ? "" : "s"}.` : "— no recent findings."}
                  </TooltipContent>
                </Tooltip>
              );
            })}

            {/* Synthesizer hub */}
            <Tooltip>
              <TooltipTrigger asChild>
                <g className="cursor-pointer">
                  <motion.circle
                    cx={HUB_X}
                    cy={hubY}
                    r={38}
                    fill="none"
                    stroke="var(--color-accent-primary)"
                    strokeWidth={1}
                    strokeDasharray="3 7"
                    strokeOpacity={hasData ? 0.3 : 0.12}
                    animate={animated ? { strokeDashoffset: [0, -40] } : undefined}
                    transition={animated ? { duration: 8, repeat: Infinity, ease: "linear" } : undefined}
                  />
                  <circle cx={HUB_X} cy={hubY} r={26} fill="rgba(255,255,255,0.04)" stroke="var(--color-accent-primary)" strokeOpacity={hasData ? 0.9 : 0.35} strokeWidth={1.5} />
                  <foreignObject x={HUB_X - 14} y={hubY - 14} width={28} height={28} className="pointer-events-none">
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-accent-primary)", opacity: hasData ? 0.95 : 0.5 }}>
                      <IconTopologyStar3 size={22} stroke={1.75} />
                    </div>
                  </foreignObject>
                  <text x={HUB_X} y={hubY + 44} textAnchor="middle" className="fill-content-muted text-[10px] font-medium">
                    Synthesizer
                  </text>
                </g>
              </TooltipTrigger>
              <TooltipContent side="top">
                Merges every agent's findings, verifies each against the real diff, and drops anything unverified before it ever reaches you.
              </TooltipContent>
            </Tooltip>

            {/* Outcome */}
            <Tooltip>
              <TooltipTrigger asChild>
                <g className="cursor-pointer">
                  <rect x={OUTCOME_X - 22} y={hubY - 22} width={44} height={44} rx={13} fill="rgba(255,255,255,0.04)" stroke="var(--color-accent-success)" strokeOpacity={hasData ? 0.9 : 0.35} strokeWidth={1.5} />
                  <foreignObject x={OUTCOME_X - 12} y={hubY - 12} width={24} height={24} className="pointer-events-none">
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-accent-success)", opacity: hasData ? 0.95 : 0.5 }}>
                      <IconGitPullRequest size={18} stroke={1.75} />
                    </div>
                  </foreignObject>
                  <text x={OUTCOME_X} y={hubY + 40} textAnchor="middle" className="fill-content-muted text-[10px] font-medium">
                    Posted to PR
                  </text>
                </g>
              </TooltipTrigger>
              <TooltipContent side="left">
                Comments post directly to your GitHub or GitLab pull request — you review and merge on your own platform, on your own terms.
              </TooltipContent>
            </Tooltip>
          </svg>
        </div>

        <div className="flex items-center gap-2 border-t border-border-subtle px-4 py-2.5">
          <span
            className={
              hasData
                ? "h-1.5 w-1.5 rounded-full bg-accent-success shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                : "h-1.5 w-1.5 rounded-full border border-content-muted/60"
            }
            aria-hidden
          />
          <span className="text-xs text-content-muted font-medium">{statusDetail}</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
