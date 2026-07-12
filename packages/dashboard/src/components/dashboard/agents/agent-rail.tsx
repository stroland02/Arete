"use client";

import { IconSettings } from "@tabler/icons-react";
import { AGENTS, type Agent } from "./agent-catalog";
import { cn } from "@/lib/utils";

const TIER_LABEL = { opus: "Opus", sonnet: "Sonnet" } as const;
const TIER_CLASS = {
  opus: "border-accent-primary/25 bg-accent-primary/10 text-accent-primary",
  sonnet: "border-white/10 bg-white/5 text-content-secondary",
} as const;

export interface AgentRailProps {
  agents?: Agent[];
  findingCountById: Record<string, number>;
  hasReviews: boolean;
  selectedAgentId: string;
  onSelect: (agentId: string) => void;
  /** Opens the existing AgentConfigDrawer for this agent. */
  onConfigure: (agentId: string) => void;
}

/**
 * Left pane of the /agents workspace: an Orca-style navigator of the six
 * specialists. Each row = status dot + icon + name + tier badge + a real
 * derived status line; the selected row gets a left accent bar. The gear
 * (revealed on hover/focus) opens the existing config drawer.
 */
export function AgentRail({
  agents = AGENTS,
  findingCountById,
  hasReviews,
  selectedAgentId,
  onSelect,
  onConfigure,
}: AgentRailProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Agents rail">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
          Agents
        </h2>
        <span className="font-mono text-[10px] tabular-nums text-content-muted">
          {agents.length}
        </span>
      </header>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {agents.map((agent) => {
          const Icon = agent.icon;
          const count = findingCountById[agent.id] ?? 0;
          const selected = agent.id === selectedAgentId;
          const status = hasReviews
            ? `Analyzed · ${count} finding${count === 1 ? "" : "s"}`
            : "Idle";

          return (
            <li key={agent.id} className="group relative">
              {selected && (
                <span
                  className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-accent-primary"
                  aria-hidden
                />
              )}
              <button
                type="button"
                onClick={() => onSelect(agent.id)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                  selected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    hasReviews
                      ? "bg-accent-success shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                      : "bg-content-muted/40"
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "mt-0.5 shrink-0",
                    selected ? "text-accent-primary" : "text-content-muted"
                  )}
                >
                  <Icon size={15} stroke={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate text-[13px] font-medium",
                        selected ? "text-content-primary" : "text-content-secondary"
                      )}
                    >
                      {agent.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-px text-[9px] font-medium",
                        TIER_CLASS[agent.tier]
                      )}
                    >
                      {TIER_LABEL[agent.tier]}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-content-muted">
                    {status}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onConfigure(agent.id)}
                aria-label={`Configure the ${agent.label} agent`}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-content-muted opacity-0 transition-opacity hover:bg-white/10 hover:text-content-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50 group-hover:opacity-100"
              >
                <IconSettings size={14} stroke={1.75} />
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="shrink-0 border-t border-border-subtle px-3 py-2">
        <p className="font-mono text-[10px] leading-4 text-content-muted/80">
          {hasReviews
            ? "counts are verified findings from your reviews"
            : "agents run automatically on your pull requests"}
        </p>
      </footer>
    </section>
  );
}
