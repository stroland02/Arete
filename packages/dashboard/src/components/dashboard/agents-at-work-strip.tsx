import { AGENTS } from "./agents/agent-catalog";
import { cn } from "@/lib/utils";

/**
 * Overview "agents at work" strip (approved Overview redesign, artifact
 * 0f96f422) — the six specialists and what each has caught, drawn straight from
 * real review data (`commentsByCategory`, keyed by agent id == category). It
 * replaces the old node-graph with a calm, legible status row that ties the
 * Overview to the /agents workspace.
 *
 * HONESTY: counts are real. Before any review has run, every card shows a muted
 * "stands ready" — never a fabricated number, never a fake-active state.
 */
export function AgentsAtWorkStrip({
  findingCountById,
  hasReviews,
}: {
  findingCountById: Record<string, number>;
  hasReviews: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {AGENTS.map((agent) => {
        const count = findingCountById[agent.id] ?? 0;
        const Icon = agent.icon;
        const caught = hasReviews && count > 0;
        return (
          <div
            key={agent.id}
            className={cn(
              "flex flex-col gap-2 rounded-xl border p-3 transition-colors",
              caught
                ? "border-border-default bg-surface-1"
                : "border-border-subtle bg-surface-1/50",
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg border",
                  caught
                    ? "border-accent-primary/25 bg-accent-primary/10 text-accent-primary"
                    : "border-border-default bg-surface-2 text-content-muted",
                )}
              >
                <Icon size={15} stroke={1.75} />
              </span>
              {hasReviews ? (
                <span
                  className={cn(
                    "font-mono text-lg font-semibold tabular-nums",
                    caught ? "text-content-primary" : "text-content-muted/70",
                  )}
                >
                  {count}
                </span>
              ) : (
                <span className="font-mono text-lg text-content-muted/40" aria-hidden>
                  —
                </span>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-content-secondary">{agent.label}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-content-muted">
                {!hasReviews
                  ? "Stands ready"
                  : count === 0
                    ? "Clear in its lane"
                    : `${count} verified ${count === 1 ? "finding" : "findings"}`}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
