"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  IconChartBar,
  IconEye,
  IconShieldCheck,
  IconTopologyStar3,
  IconUserCheck,
} from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type AgentIcon = React.ComponentType<{
  size?: number;
  stroke?: number;
  style?: React.CSSProperties;
}>;

interface AgentNode {
  id: string;
  label: string;
  description: string;
  x: number;
  y: number;
  r: number;
  /** The human review gate renders as a rounded square, not a circle. */
  shape: "circle" | "gate";
  color: string;
  icon: AgentIcon;
  iconSize: number;
  labelDy: number;
  /** Phase-shifted pulse so nodes don't all breathe on the same beat. */
  pulseDelay: number;
  pulseDuration: number;
}

const NODES: AgentNode[] = [
  {
    id: "monitoring",
    label: "Monitoring",
    description: "Continuous telemetry ingestion and anomaly detection.",
    x: 60,
    y: 48,
    r: 22,
    shape: "circle",
    color: "var(--color-accent-info)",
    icon: IconEye,
    iconSize: 18,
    labelDy: 38,
    pulseDelay: 0,
    pulseDuration: 2.8,
  },
  {
    id: "analytics",
    label: "Analytics",
    description: "Root cause analysis and pattern recognition.",
    x: 60,
    y: 140,
    r: 22,
    shape: "circle",
    color: "var(--color-accent-primary)",
    icon: IconChartBar,
    iconSize: 18,
    labelDy: 38,
    pulseDelay: 0.9,
    pulseDuration: 2.4,
  },
  {
    id: "security",
    label: "Security",
    description: "Vulnerability scanning and OWASP compliance.",
    x: 60,
    y: 232,
    r: 22,
    shape: "circle",
    color: "var(--color-accent-danger)",
    icon: IconShieldCheck,
    iconSize: 18,
    labelDy: 38,
    pulseDelay: 1.6,
    pulseDuration: 3.2,
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    description: "Aggregates agent findings into ranked proposals.",
    x: 220,
    y: 140,
    r: 28,
    shape: "circle",
    color: "var(--color-accent-primary)",
    icon: IconTopologyStar3,
    iconSize: 22,
    labelDy: 44,
    pulseDelay: 0.4,
    pulseDuration: 2.6,
  },
  {
    id: "review-gate",
    label: "Human Review Gate",
    description: "Developer reviews reasoning, diff, and risk before merge.",
    x: 360,
    y: 140,
    r: 22,
    shape: "gate",
    color: "var(--color-accent-success)",
    icon: IconUserCheck,
    iconSize: 20,
    labelDy: 40,
    pulseDelay: 1.2,
    pulseDuration: 3.0,
  },
];

interface Edge {
  from: string;
  to: string;
  d: string;
  /** Particle carries the source agent's accent color into the hub. */
  color: string;
  duration: number;
  delay: number;
}

const EDGES: Edge[] = [
  {
    from: "monitoring",
    to: "orchestrator",
    d: "M 84,48 C 150,48 150,140 192,140",
    color: "var(--color-accent-info)",
    duration: 2.6,
    delay: 0,
  },
  {
    from: "analytics",
    to: "orchestrator",
    d: "M 84,140 L 192,140",
    color: "var(--color-accent-primary)",
    duration: 2.2,
    delay: 0.9,
  },
  {
    from: "security",
    to: "orchestrator",
    d: "M 84,232 C 150,232 150,140 192,140",
    color: "var(--color-accent-danger)",
    duration: 3.0,
    delay: 1.7,
  },
  {
    from: "orchestrator",
    to: "review-gate",
    d: "M 248,140 L 338,140",
    color: "var(--color-accent-primary)",
    duration: 2.4,
    delay: 0.5,
  },
];

interface AgentOrchestrationGraphProps {
  activeRepos: number;
  totalPrs: number;
}

export function AgentOrchestrationGraph({ activeRepos, totalPrs }: AgentOrchestrationGraphProps) {
  const isLive = activeRepos > 0 || totalPrs > 0;
  const reducedMotion = useReducedMotion();
  /**
   * Perpetual/looping motion (particles, pulses, ring crawl) only runs when the
   * pipeline is live AND the user hasn't asked for reduced motion. Static
   * live/idle styling and status text stay driven by `isLive` so reduced-motion
   * users still get accurate state — just without anything that loops.
   */
  const animated = isLive && !reducedMotion;
  const uid = useId();
  const dotGridId = `${uid}-dot-grid`;
  const glowId = `${uid}-node-glow`;

  const statusDetail = isLive
    ? activeRepos > 0
      ? `processing ${activeRepos} ${activeRepos === 1 ? "repository" : "repositories"}`
      : `reviewing ${totalPrs} ${totalPrs === 1 ? "pull request" : "pull requests"}`
    : "waiting for PR activity";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col border border-border-subtle rounded-xl bg-white/[0.02] backdrop-blur-sm overflow-hidden">
        <div className="h-72 flex items-center justify-center">
          <svg
            viewBox="0 0 400 280"
            className="w-full h-full max-w-xl"
            role="img"
            aria-label="Agent orchestration graph: Monitoring, Analytics, and Security feed the Orchestrator, gated by human review"
          >
            <defs>
              <pattern id={dotGridId} width={20} height={20} patternUnits="userSpaceOnUse">
                <circle cx={1.5} cy={1.5} r={1} fill="rgba(255,255,255,0.04)" />
              </pattern>
              <filter id={glowId} x="-75%" y="-75%" width="250%" height="250%">
                <feGaussianBlur stdDeviation={8} />
              </filter>
            </defs>

            {/* Dot-grid floor sits behind everything */}
            <rect width={400} height={280} fill={`url(#${dotGridId})`} />

            {EDGES.map((edge) => (
              <g key={`${edge.from}-${edge.to}`}>
                <path
                  d={edge.d}
                  fill="none"
                  stroke={isLive ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.06)"}
                  strokeWidth={1.5}
                />
                {animated && (
                  <motion.circle
                    r={3}
                    fill={edge.color}
                    style={{ offsetPath: `path('${edge.d}')` }}
                    initial={{ offsetDistance: "0%", opacity: 0 }}
                    animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
                    transition={{
                      duration: edge.duration,
                      delay: edge.delay,
                      repeat: Infinity,
                      ease: "easeInOut",
                      opacity: {
                        duration: edge.duration,
                        delay: edge.delay,
                        repeat: Infinity,
                        times: [0, 0.15, 0.8, 1],
                        ease: "linear",
                      },
                    }}
                  />
                )}
              </g>
            ))}

            {NODES.map((node) => {
              const Icon = node.icon;
              const pulseTransition = {
                duration: node.pulseDuration,
                delay: node.pulseDelay,
                repeat: Infinity,
                ease: "easeInOut" as const,
              };

              return (
                <Tooltip key={node.id}>
                  <TooltipTrigger asChild>
                    <g className="cursor-pointer">
                      {/* Soft accent glow gives live nodes presence */}
                      {isLive && (
                        <motion.circle
                          cx={node.x}
                          cy={node.y}
                          r={node.r + 12}
                          fill={node.color}
                          filter={`url(#${glowId})`}
                          className="pointer-events-none"
                          animate={animated ? { opacity: [0.1, 0.22, 0.1] } : { opacity: 0.16 }}
                          transition={animated ? pulseTransition : undefined}
                        />
                      )}

                      {/* Slowly crawling dashed ring marks the orchestrator as the hub */}
                      {node.id === "orchestrator" && (
                        <motion.circle
                          cx={node.x}
                          cy={node.y}
                          r={38}
                          fill="none"
                          stroke={node.color}
                          strokeWidth={1}
                          strokeDasharray="3 7"
                          strokeOpacity={isLive ? 0.3 : 0.12}
                          animate={animated ? { strokeDashoffset: [0, -40] } : undefined}
                          transition={
                            animated
                              ? { duration: 8, repeat: Infinity, ease: "linear" }
                              : undefined
                          }
                        />
                      )}

                      {node.shape === "gate" ? (
                        <motion.rect
                          x={node.x - 22}
                          y={node.y - 22}
                          width={44}
                          height={44}
                          rx={13}
                          fill="rgba(255,255,255,0.04)"
                          stroke={node.color}
                          strokeOpacity={isLive ? 0.9 : 0.35}
                          strokeWidth={1.5}
                          animate={animated ? { opacity: [0.75, 1, 0.75] } : { opacity: isLive ? 1 : 0.6 }}
                          transition={animated ? pulseTransition : undefined}
                        />
                      ) : (
                        <motion.circle
                          cx={node.x}
                          cy={node.y}
                          r={node.r}
                          fill="rgba(255,255,255,0.04)"
                          stroke={node.color}
                          strokeOpacity={isLive ? 0.9 : 0.35}
                          strokeWidth={1.5}
                          animate={animated ? { opacity: [0.75, 1, 0.75] } : { opacity: isLive ? 1 : 0.6 }}
                          transition={animated ? pulseTransition : undefined}
                        />
                      )}

                      <foreignObject
                        x={node.x - 14}
                        y={node.y - 14}
                        width={28}
                        height={28}
                        className="pointer-events-none"
                      >
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: node.color,
                            opacity: isLive ? 0.95 : 0.5,
                          }}
                        >
                          <Icon size={node.iconSize} stroke={1.75} />
                        </div>
                      </foreignObject>

                      <text
                        x={node.x}
                        y={node.y + node.labelDy}
                        textAnchor="middle"
                        className="fill-content-muted text-[10px] font-medium"
                      >
                        {node.label}
                      </text>
                    </g>
                  </TooltipTrigger>
                  <TooltipContent side="top">{node.description}</TooltipContent>
                </Tooltip>
              );
            })}
          </svg>
        </div>

        <div className="flex items-center gap-2 border-t border-border-subtle px-4 py-2.5">
          <span
            className={
              isLive
                ? "h-1.5 w-1.5 rounded-full bg-accent-success shadow-[0_0_8px_rgba(52,211,153,0.7)] animate-pulse motion-reduce:animate-none"
                : "h-1.5 w-1.5 rounded-full border border-content-muted/60"
            }
            aria-hidden
          />
          <span className="text-xs text-content-muted font-medium">
            {NODES.filter((node) => node.shape !== "gate").length} agents + human review{" "}
            {isLive ? "active" : "idle"}
            <span className="text-content-muted/60"> • </span>
            {statusDetail}
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}
