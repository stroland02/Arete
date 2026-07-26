"use client";

import { IconSettings } from "@tabler/icons-react";
import { AGENTS } from "../agents/agent-catalog";

/**
 * The agents layer, inside the Services rail (Stage 2.2).
 *
 * The locked decision is that Agents stops being a second place to look:
 * "one place to see what Kuma is doing to my services rather than two". So the
 * specialists live here, beside the work they produced — selecting one opens
 * its conversation in the centre pane, and the gear opens its parameters.
 *
 * Deliberately NOT a copy of `agents/agent-rail.tsx`. That rail owns the whole
 * left column of /agents and also carries the work inbox; this is a section
 * inside a rail that already has repos, work items and approvals above it. It
 * renders from the same `AGENTS` catalogue, so the two cannot disagree about
 * which specialists exist or what they are called.
 *
 * Counts are passed in, never derived here: a count this component computed
 * could drift from the one the rest of the page shows.
 */
export function AgentsSection({
  findingCountById,
  activeAgentId,
  onSelect,
  onConfigure,
}: {
  findingCountById: Record<string, number>;
  activeAgentId: string | null;
  onSelect: (agentId: string) => void;
  onConfigure: (agentId: string) => void;
}) {
  return (
    <div className="border-b border-border-subtle">
      <header className="px-3 pb-1 pt-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">
          Agents
        </h3>
        <p className="mt-0.5 text-[10px] leading-4 text-content-muted/80">
          Open one to see its reasoning, or set how it runs.
        </p>
      </header>

      <ul className="py-1">
        {AGENTS.map((agent) => {
          const Icon = agent.icon;
          const count = findingCountById[agent.id] ?? 0;
          const on = agent.id === activeAgentId;
          return (
            <li key={agent.id} className="relative">
              <div
                className={`flex w-full items-center gap-2 py-1.5 pl-3 pr-2 transition-colors ${
                  on ? "bg-accent-primary/[0.1] text-content-primary" : "hover:bg-content-primary/5"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(agent.id)}
                  aria-current={on ? "true" : undefined}
                  aria-label={`Open the ${agent.label} agent`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Icon
                    size={14}
                    stroke={1.75}
                    className={on ? "text-accent-primary" : "text-content-muted"}
                    aria-hidden
                  />
                  <span className="truncate text-[12px] font-medium">{agent.label}</span>
                  {/* Zero renders as nothing, not "0". An agent that has not
                      run and an agent that found nothing are different states,
                      and neither is a score. */}
                  {count > 0 ? (
                    <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-content-muted">
                      {count}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => onConfigure(agent.id)}
                  aria-label={`Configure the ${agent.label} agent`}
                  className="shrink-0 rounded p-0.5 text-content-muted transition-colors hover:text-content-secondary"
                >
                  <IconSettings size={13} stroke={1.75} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
