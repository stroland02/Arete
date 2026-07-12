"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { springTransition } from "@/lib/motion";
import type { Agent, AgentTier } from "./agent-catalog";

const TIER_BADGE: Record<AgentTier, { label: string; className: string }> = {
  opus: {
    label: "Opus",
    className: "bg-accent-primary/10 text-accent-primary border-accent-primary/25",
  },
  sonnet: {
    label: "Sonnet",
    className: "bg-white/5 text-content-secondary border-white/10",
  },
};

export interface AgentCardProps {
  agent: Agent;
  findingCount: number;
  hasReviews: boolean;
  onOpen: (id: string) => void;
}

/**
 * Uniform specialist card. Status is honestly derived from the latest
 * reviews' posted comments (Idle / Analyzed · N / No findings) — there is no
 * live per-agent run stream to show, so we never pretend there is one.
 */
export function AgentCard({ agent, findingCount, hasReviews, onOpen }: AgentCardProps) {
  const Icon = agent.icon;
  const analyzed = hasReviews && findingCount > 0;

  const status = !hasReviews
    ? "Idle"
    : findingCount > 0
      ? `Analyzed · ${findingCount} finding${findingCount === 1 ? "" : "s"}`
      : "No findings";

  const dotClass = !hasReviews
    ? "border border-content-muted/60"
    : findingCount > 0
      ? "bg-accent-primary shadow-[0_0_8px_rgba(129,140,248,0.7)]"
      : "bg-accent-success/70";

  const tier = TIER_BADGE[agent.tier];

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(agent.id)}
      whileHover={{ y: -2 }}
      transition={springTransition}
      aria-label={`Open ${agent.label} agent details and settings`}
      className="glass-panel flex h-full cursor-pointer flex-col gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent-primary/15 bg-accent-primary/10 text-accent-primary">
          <Icon size={18} stroke={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content-primary">
          {agent.label}
        </span>
        <Badge className={tier.className}>{tier.label}</Badge>
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-content-muted">
        {agent.description}
      </p>

      <div className="mt-auto flex items-center gap-2 border-t border-border-subtle pt-3">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
        <span className="text-xs font-medium text-content-secondary">{status}</span>
        {analyzed && (
          <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] tabular-nums text-content-muted">
            {findingCount}
          </span>
        )}
      </div>
    </motion.button>
  );
}
