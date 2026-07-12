"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  IconBriefcase,
  IconChecks,
  IconGauge,
  IconGitPullRequest,
  IconPlugConnected,
  IconRocket,
  IconShieldCheck,
  IconSparkles,
  IconTestPipe,
  IconTopologyStar3,
} from "@tabler/icons-react";

/**
 * Hero-scale, self-contained illustration of Areté's review pipeline for the
 * marketing landing page. Unlike the dashboard's data-driven
 * AgentOrchestrationGraph, this takes NO props: the counts below are fixed,
 * illustrative sample values chosen to read well, and the surrounding hero
 * labels this panel "Illustrative example" so a visitor can never mistake it
 * for real account activity (mirrors the "sample data" pattern in
 * docs/design-references/). The six agents and the Synthesizer step map 1:1
 * to the real agents in packages/agents/src/arete_agents/agents/*.py.
 */

type IconType = React.ComponentType<{ size?: number; stroke?: number }>;

interface AgentDef {
  id: string;
  label: string;
  color: string;
  icon: IconType;
}

// Six specialists, each given a distinct hue purely so the parallel fan reads
// clearly. Order + labels match the authenticated dashboard's agent set.
const AGENTS: AgentDef[] = [
  { id: "security", label: "Security", color: "#fb7185", icon: IconShieldCheck },
  { id: "performance", label: "Performance", color: "#22d3ee", icon: IconGauge },
  { id: "quality", label: "Quality", color: "#c084fc", icon: IconSparkles },
  { id: "test_coverage", label: "Test Coverage", color: "#34d399", icon: IconTestPipe },
  { id: "deployment_safety", label: "Deploy Safety", color: "#f59e0b", icon: IconRocket },
  { id: "business_logic", label: "Business Logic", color: "#818cf8", icon: IconBriefcase },
];

const TELEMETRY = ["Sentry", "Vercel", "Stripe"];

// Illustrative funnel totals shown in the footer strip — the whole point of the
// product (verify, then drop what can't be proven) made concrete but honest.
const RAISED = 13;
const VERIFIED = 9;
const FILTERED = RAISED - VERIFIED;

// Geometry (SVG user units; the SVG itself scales to its container width).
const VB_W = 740;
const VB_H = 430;
const AGENT_X = 244;
const AGENT_R = 22;
const TOP_Y = 44;
const ROW_GAP = 66;
const SYNTH_X = 478;
const SYNTH_R = 34;
const OUT_X = 672;
const OUT_HALF = 26;
const TEL_X = 72;
const TEL_R = 24;

const agentY = (i: number) => TOP_Y + i * ROW_GAP;
const HUB_Y = (agentY(0) + agentY(AGENTS.length - 1)) / 2;
const bizY = agentY(AGENTS.length - 1); // business_logic is the last row

function agentEdge(y: number) {
  const midX = (AGENT_X + SYNTH_X) / 2;
  return `M ${AGENT_X + AGENT_R},${y} C ${midX},${y} ${midX},${HUB_Y} ${SYNTH_X - SYNTH_R},${HUB_Y}`;
}
const SYNTH_TO_OUT = `M ${SYNTH_X + SYNTH_R},${HUB_Y} L ${OUT_X - OUT_HALF},${HUB_Y}`;
const TEL_TO_BIZ = `M ${TEL_X + TEL_R},${bizY} L ${AGENT_X - AGENT_R - 3},${bizY}`;

export function HeroAgentGraph() {
  const reduce = useReducedMotion();
  const uid = useId();
  const dotId = `${uid}-dots`;
  const glowId = `${uid}-glow`;
  const animated = !reduce;

  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-md shadow-[0_20px_70px_-30px_rgba(2,6,23,0.9)] overflow-hidden">
      {/* window chrome / context bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <IconGitPullRequest size={14} className="text-content-muted shrink-0" />
          <span className="font-mono text-[11px] text-content-secondary truncate">
            PR #418 · auth: rotate refresh tokens
          </span>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium tracking-wide text-content-muted">
          Illustrative
        </span>
      </div>

      {/* graph */}
      <div className="px-2 py-3">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="w-full h-auto"
          role="img"
          aria-label="Six specialist agents review a pull request in parallel and feed a Synthesizer, which verifies each finding against the diff and posts only the verified comments back to the pull request."
        >
          <defs>
            <pattern id={dotId} width={22} height={22} patternUnits="userSpaceOnUse">
              <circle cx={1.5} cy={1.5} r={1} fill="rgba(255,255,255,0.035)" />
            </pattern>
            <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation={7} />
            </filter>
          </defs>

          <rect width={VB_W} height={VB_H} fill={`url(#${dotId})`} />

          {/* agent → synthesizer edges + flow particles */}
          {AGENTS.map((a, i) => {
            const d = agentEdge(agentY(i));
            return (
              <g key={`edge-${a.id}`}>
                <path d={d} fill="none" stroke={a.color} strokeOpacity={0.28} strokeWidth={1.5} />
                {animated && (
                  <motion.circle
                    r={2.6}
                    fill={a.color}
                    style={{ offsetPath: `path('${d}')` }}
                    initial={{ offsetDistance: "0%", opacity: 0 }}
                    animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
                    transition={{
                      duration: 2.6,
                      delay: i * 0.28,
                      repeat: Infinity,
                      ease: "easeInOut",
                      opacity: { duration: 2.6, delay: i * 0.28, repeat: Infinity, times: [0, 0.12, 0.85, 1], ease: "linear" },
                    }}
                  />
                )}
              </g>
            );
          })}

          {/* synthesizer → outcome */}
          <path d={SYNTH_TO_OUT} fill="none" stroke="#34d399" strokeOpacity={0.4} strokeWidth={2} />
          {animated && (
            <motion.circle
              r={3.4}
              fill="#34d399"
              style={{ offsetPath: `path('${SYNTH_TO_OUT}')` }}
              initial={{ offsetDistance: "0%", opacity: 0 }}
              animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut", opacity: { duration: 1.9, repeat: Infinity, times: [0, 0.15, 0.8, 1], ease: "linear" } }}
            />
          )}

          {/* telemetry → business logic (dashed input) */}
          <path d={TEL_TO_BIZ} fill="none" stroke="#818cf8" strokeOpacity={0.3} strokeWidth={1.25} strokeDasharray="2 4" />
          {animated && (
            <motion.circle
              r={2}
              fill="#818cf8"
              style={{ offsetPath: `path('${TEL_TO_BIZ}')` }}
              initial={{ offsetDistance: "0%", opacity: 0 }}
              animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 0.9, 0.9, 0] }}
              transition={{ duration: 2.2, delay: 0.6, repeat: Infinity, ease: "easeInOut", opacity: { duration: 2.2, delay: 0.6, repeat: Infinity, times: [0, 0.15, 0.8, 1], ease: "linear" } }}
            />
          )}

          {/* telemetry input node */}
          <g>
            <circle cx={TEL_X} cy={bizY} r={TEL_R} fill="rgba(255,255,255,0.03)" stroke="#818cf8" strokeOpacity={0.5} strokeWidth={1.25} strokeDasharray="3 4" />
            <foreignObject x={TEL_X - 11} y={bizY - 11} width={22} height={22}>
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#818cf8" }}>
                <IconPlugConnected size={15} stroke={1.75} />
              </div>
            </foreignObject>
            <text x={TEL_X} y={bizY + TEL_R + 15} textAnchor="middle" className="fill-content-muted text-[10px] font-medium">
              Your telemetry
            </text>
            <text x={TEL_X} y={bizY + TEL_R + 28} textAnchor="middle" className="fill-content-muted/60 text-[9px]">
              {TELEMETRY.join(" · ")}
            </text>
          </g>

          {/* agent nodes */}
          {AGENTS.map((a, i) => {
            const y = agentY(i);
            const Icon = a.icon;
            return (
              <g key={a.id}>
                <motion.circle
                  cx={AGENT_X}
                  cy={y}
                  r={AGENT_R + 9}
                  fill={a.color}
                  filter={`url(#${glowId})`}
                  animate={animated ? { opacity: [0.1, 0.24, 0.1] } : { opacity: 0.16 }}
                  transition={animated ? { duration: 2.6, delay: i * 0.28, repeat: Infinity, ease: "easeInOut" } : undefined}
                />
                <circle cx={AGENT_X} cy={y} r={AGENT_R} fill="rgba(2,6,23,0.6)" stroke={a.color} strokeOpacity={0.85} strokeWidth={1.5} />
                <foreignObject x={AGENT_X - 12} y={y - 12} width={24} height={24}>
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: a.color }}>
                    <Icon size={17} stroke={1.75} />
                  </div>
                </foreignObject>
                <text x={AGENT_X + AGENT_R + 10} y={y + 4} className="fill-content-secondary text-[12px] font-medium">
                  {a.label}
                </text>
              </g>
            );
          })}

          {/* synthesizer hub */}
          <g>
            <motion.circle
              cx={SYNTH_X}
              cy={HUB_Y}
              r={SYNTH_R + 8}
              fill="none"
              stroke="#818cf8"
              strokeWidth={1}
              strokeDasharray="3 7"
              strokeOpacity={0.35}
              animate={animated ? { strokeDashoffset: [0, -40] } : undefined}
              transition={animated ? { duration: 8, repeat: Infinity, ease: "linear" } : undefined}
            />
            <motion.circle
              cx={SYNTH_X}
              cy={HUB_Y}
              r={SYNTH_R + 14}
              fill="#818cf8"
              filter={`url(#${glowId})`}
              animate={animated ? { opacity: [0.08, 0.18, 0.08] } : { opacity: 0.12 }}
              transition={animated ? { duration: 3, repeat: Infinity, ease: "easeInOut" } : undefined}
            />
            <circle cx={SYNTH_X} cy={HUB_Y} r={SYNTH_R} fill="rgba(2,6,23,0.7)" stroke="#818cf8" strokeOpacity={0.9} strokeWidth={1.75} />
            <foreignObject x={SYNTH_X - 16} y={HUB_Y - 16} width={32} height={32}>
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#a5b4fc" }}>
                <IconTopologyStar3 size={26} stroke={1.75} />
              </div>
            </foreignObject>
            <text x={SYNTH_X} y={HUB_Y + SYNTH_R + 18} textAnchor="middle" className="fill-content-primary text-[12px] font-semibold">
              Synthesizer
            </text>
            <text x={SYNTH_X} y={HUB_Y + SYNTH_R + 32} textAnchor="middle" className="fill-content-muted text-[9.5px]">
              verifies every finding
            </text>
          </g>

          {/* outcome */}
          <g>
            <motion.rect
              x={OUT_X - OUT_HALF - 6}
              y={HUB_Y - OUT_HALF - 6}
              width={(OUT_HALF + 6) * 2}
              height={(OUT_HALF + 6) * 2}
              rx={18}
              fill="#34d399"
              filter={`url(#${glowId})`}
              animate={animated ? { opacity: [0.08, 0.16, 0.08] } : { opacity: 0.12 }}
              transition={animated ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : undefined}
            />
            <rect x={OUT_X - OUT_HALF} y={HUB_Y - OUT_HALF} width={OUT_HALF * 2} height={OUT_HALF * 2} rx={15} fill="rgba(2,6,23,0.7)" stroke="#34d399" strokeOpacity={0.9} strokeWidth={1.75} />
            <foreignObject x={OUT_X - 13} y={HUB_Y - 13} width={26} height={26}>
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#6ee7b7" }}>
                <IconChecks size={20} stroke={1.75} />
              </div>
            </foreignObject>
            <text x={OUT_X} y={HUB_Y + OUT_HALF + 18} textAnchor="middle" className="fill-content-primary text-[12px] font-semibold">
              Posted to PR
            </text>
            <text x={OUT_X} y={HUB_Y + OUT_HALF + 32} textAnchor="middle" className="fill-content-muted text-[9.5px]">
              verified only
            </text>
          </g>
        </svg>
      </div>

      {/* value footer: the signal-vs-noise funnel, honestly labelled */}
      <div className="flex items-center gap-4 border-t border-white/[0.06] px-4 py-3 text-[11px]">
        <FunnelStat color="#94a3b8" label={`${RAISED} raised`} />
        <span className="text-content-muted/40">→</span>
        <FunnelStat color="#34d399" label={`${VERIFIED} verified & posted`} />
        <span className="text-content-muted/40">→</span>
        <FunnelStat color="#818cf8" label={`${FILTERED} filtered as noise`} />
      </div>
    </div>
  );
}

function FunnelStat({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-content-secondary">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}80` }} />
      {label}
    </span>
  );
}
