"use client";

import { useRouter } from "next/navigation";
import { AGENTS, type Agent } from "./agent-catalog";
import { cn } from "@/lib/utils";
import { IconSettings, IconCpu } from "@tabler/icons-react";
import { WorkItemInboxSection } from "@/components/dashboard/services/work-item-inbox";
import type { ActiveModelConnection } from "@/lib/model-connections-map";
import type { InboxView } from "@/lib/work-items";

export interface AgentRailProps {
  agents?: Agent[];
  findingCountById: Record<string, number>;
  hasReviews: boolean;
  selectedAgentId: string;
  onSelect: (agentId: string) => void;
  /** Opens the AgentConfigDrawer for this agent. */
  onConfigure: (agentId: string) => void;
  /** The connected model all agents run on — shown once in the footer, replacing
      the old per-agent hardcoded Opus/Sonnet tier badges. */
  activeModel?: ActiveModelConnection | null;
  /**
   * The live work-item inbox — what the agents are currently working on. Null on
   * a fresh/unconnected account (nothing to scan yet), in which case the section
   * is omitted rather than shown empty. Selecting an item deep-links to /services
   * where the item can be acted on; the Agents page provides visibility, not a
   * second copy of the action surface.
   */
  inbox?: InboxView | null;
}

/**
 * Left pane of the /agents workspace: an Orca-style navigator of the six
 * specialists. Each row = status dot + icon + name + model badge + a real
 * derived status line. Clicking a row selects that agent, driving the center
 * conversation pane; a separate gear button opens its config drawer. The
 * whole row highlights on hover and gets a left accent bar + tinted
 * background when it's the selected one.
 */
export function AgentRail({
  agents = AGENTS,
  findingCountById,
  hasReviews,
  selectedAgentId,
  onSelect,
  onConfigure,
  activeModel = null,
  inbox = null,
}: AgentRailProps) {
  const router = useRouter();
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

      <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-1">
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

      {/* What the agents are working on — the live work inbox, bounded so it
          never crowds out the agents list on a short viewport. Selecting an
          item hands off to /services (focused on its container when there is
          one) to act on it. */}
      {inbox && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-border-subtle">
          <WorkItemInboxSection
            inbox={inbox}
            activeItemId={null}
            onSelect={(item) =>
              router.push(item.containerId ? `/services?container=${encodeURIComponent(item.containerId)}` : "/services")
            }
          />
        </div>
      )}

      <footer className="shrink-0 space-y-1.5 border-t border-border-subtle px-3 py-2">
        {activeModel ? (
          <p
            title={`Every agent runs on ${activeModel.provider} · ${activeModel.model}`}
            className="flex items-center gap-1.5 text-[10px] text-content-secondary"
          >
            <IconCpu size={12} className="shrink-0 text-accent-primary" aria-hidden />
            <span className="text-content-muted">Running on</span>
            <span className="min-w-0 flex-1 truncate font-mono text-content-secondary">{activeModel.model}</span>
          </p>
        ) : (
          <p className="font-mono text-[10px] leading-4 text-content-muted/80">
            no model connected — agents can&apos;t run yet
          </p>
        )}
        <p className="font-mono text-[10px] leading-4 text-content-muted/80">
          {hasReviews
            ? "counts are verified findings from your reviews"
            : "agents run automatically on your pull requests"}
        </p>
      </footer>
    </section>
  );
}
