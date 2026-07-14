"use client";

import { AGENTS, type Agent } from "./agent-catalog";
import { cn } from "@/lib/utils";
import { IconSettings } from "@tabler/icons-react";

const TIER_LABEL = { opus: "Opus", sonnet: "Sonnet" } as const;
const TIER_CLASS = {
  opus: "border-accent-primary/25 bg-accent-primary/10 text-accent-primary",
  sonnet: "border-border-default bg-surface-2 text-content-secondary",
} as const;

export interface AgentRailProps {
  agents?: Agent[];
  findingCountById: Record<string, number>;
  hasReviews: boolean;
  selectedAgentId: string;
  onSelect: (agentId: string) => void;
  /** Opens the AgentConfigDrawer for this agent. */
  onConfigure: (agentId: string) => void;
}

/**
 * Left pane of the /agents workspace: an Orca-style navigator of the six
 * specialists. Each row = status dot + icon + name + model badge + a real
 * derived status line. Clicking a row selects that agent AND opens its config
 * drawer (no separate gear button); the whole row highlights on hover and
 * gets a left accent bar + tinted background when it's the open one.
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
            <li key={agent.id} className="relative">
              {selected && (
                <span
                  className="absolute inset-y-1 left-0 z-10 w-0.5 rounded-r bg-accent-primary"
                  aria-hidden
                />
              )}
              <div
                className={cn(
                  "group flex items-stretch transition-colors",
                  selected ? "bg-accent-primary/[0.06]" : "hover:bg-content-primary/[0.04]"
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(agent.id)}
                  aria-current={selected ? "true" : undefined}
                  aria-label={`View the ${agent.label} agent`}
                  className="flex min-w-0 flex-1 items-start gap-2.5 py-2.5 pl-3 pr-1 text-left"
                >
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      hasReviews ? "bg-accent-success" : "bg-content-muted/40"
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
                          "min-w-0 flex-1 truncate text-[13px] font-medium",
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
                  className="flex shrink-0 items-center px-2 text-content-muted opacity-0 transition-opacity hover:text-content-secondary focus:opacity-100 group-hover:opacity-100"
                >
                  <IconSettings size={14} stroke={1.75} />
                </button>
              </div>
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
