"use client";

import { cn } from "@/lib/utils";
import { AGENTS } from "../agent-catalog";

/**
 * Left rail of the Synthesizer console (spec §3): the six specialists. Each
 * lights up once it has reported candidates (its id is in `reportedAgentIds`).
 * A reported-but-still-working review pulses the lit nodes; a finished one is
 * static. Read-only — selection/config live on the main /agents AgentRail.
 */
export function SynthAgentsRail({
  reportedAgentIds,
  animating,
}: {
  reportedAgentIds: string[];
  animating: boolean;
}) {
  const reported = new Set(reportedAgentIds);

  return (
    <aside className="hidden shrink-0 flex-col gap-1 border-r border-border-subtle p-2 lg:flex lg:w-[168px]">
      <p className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-content-muted">
        Specialists
      </p>
      {AGENTS.map((agent) => {
        const lit = reported.has(agent.id);
        const Icon = agent.icon;
        return (
          <div
            key={agent.id}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
              lit ? "bg-accent-primary/[0.06]" : "opacity-55",
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors",
                lit
                  ? "border-accent-primary/30 bg-accent-primary/10 text-accent-primary"
                  : "border-border-default bg-surface-2 text-content-muted",
              )}
            >
              <Icon size={13} stroke={2} />
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[11px]",
                lit ? "text-content-secondary" : "text-content-muted",
              )}
            >
              {agent.label}
            </span>
            {lit && (
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full bg-accent-success",
                  animating && "motion-safe:animate-pulse",
                )}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </aside>
  );
}
