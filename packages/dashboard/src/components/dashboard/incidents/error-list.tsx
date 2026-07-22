"use client";

import Link from "next/link";
import { IconBug } from "@tabler/icons-react";
import { relativeTime } from "@/lib/relative-time";
import { Sparkline } from "@/components/dashboard/sparkline";
import { EmptyState } from "../empty-state";
import type { ErrorGroupView, ErrorStatus } from "@/lib/errors";

/**
 * The Errors list: one row per RECURRING error (an error group, keyed by
 * fingerprint) — the individual failures. Its sibling surface, Incidents, is
 * the GROUPING of these errors that get resolved together, which is why the
 * connected incident is surfaced right on the row: an error you can see here
 * tells you which incident will close it.
 *
 * Deliberately the same row language as incident-list.tsx / activity-list.tsx
 * (dot · title · pills · relative time) — this is the same inbox presentation,
 * not a new layout.
 *
 * Honesty rules:
 *  - The sparkline is drawn ONLY when there is a real multi-point series.
 *    A single bucket is not a trend, so we render nothing rather than a
 *    flat line that implies one.
 *  - The connected-incident chip appears only when the group is actually
 *    attached to an incident; there is no "unassigned" fiction.
 */

const STATUS_DOT: Record<ErrorStatus, string> = {
  open: "bg-accent-danger",
  observing: "bg-accent-warning",
  resolved: "bg-accent-success",
  silenced: "bg-content-muted",
};

const STATUS_PILL: Record<ErrorStatus, string> = {
  open: "bg-accent-danger/10 text-accent-danger border-accent-danger/25",
  observing: "bg-accent-warning/10 text-accent-warning border-accent-warning/25",
  resolved: "bg-accent-success/10 text-accent-success border-accent-success/25",
  silenced: "bg-content-primary/5 text-content-muted border-border-default",
};

function kindLabel(kind: ErrorGroupView["kind"]): string {
  return kind === "exception" ? "Exception" : "Log";
}

export interface ErrorListProps {
  errors: ErrorGroupView[];
  /**
   * Optional server action for changing a group's status (Silence / Resolve /
   * Reopen). Omitted in tests and in read-only embeddings, in which case no
   * mutation affordance is rendered at all.
   */
  statusAction?: (formData: FormData) => void | Promise<void>;
  /** Copy for the empty case, so each status filter can be honest about itself. */
  emptyTitle?: string;
  emptyDescription?: string;
}

export function ErrorList({
  errors,
  statusAction,
  emptyTitle = "No errors",
  emptyDescription = "Recurring exceptions and error logs will appear here as they are recorded.",
}: ErrorListProps) {
  if (errors.length === 0) {
    return (
      <EmptyState
        icon={<IconBug className="w-6 h-6" />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  const now = new Date();

  return (
    <div className="flex flex-col">
      {errors.map((group) => (
        <div
          key={group.fingerprint}
          className="flex flex-col gap-1 rounded-lg px-2 py-2.5 transition-colors hover:bg-content-primary/[0.04]"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[group.status]}`}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-content-primary">
              {group.title}
            </span>
            <span className="shrink-0 font-mono text-[12px] text-content-muted">
              {group.service}
            </span>
            <span className="shrink-0 rounded-full border border-border-default bg-content-primary/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-content-muted">
              {kindLabel(group.kind)}
            </span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_PILL[group.status]}`}
            >
              {group.status}
            </span>
            {/* A single bucket is not a trend — no fabricated series. */}
            {group.dailyCounts.length > 1 && (
              <Sparkline
                data={group.dailyCounts}
                className="h-5 w-14 shrink-0"
                fillGradient
                endDot
              />
            )}
            <span className="shrink-0 text-[11px] tabular-nums text-content-muted">
              {group.eventCount} {group.eventCount === 1 ? "event" : "events"}
            </span>
            <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-content-muted">
              {relativeTime(new Date(group.lastSeen), now)}
            </span>
          </div>

          <div className="flex items-center gap-2 pl-[18px]">
            <p className="min-w-0 flex-1 truncate text-[11px] leading-4 text-content-muted">
              {group.message}
            </p>

            {group.incidentId && (
              <Link
                href={`/incidents/${group.incidentId}`}
                className="shrink-0 rounded-full border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[11px] font-medium text-accent-primary transition-colors hover:bg-accent-primary/15"
              >
                {group.incidentAlertName ?? "Connected incident"}
              </Link>
            )}

            {statusAction && (
              <form action={statusAction} className="flex shrink-0 items-center gap-1">
                <input type="hidden" name="fingerprint" value={group.fingerprint} />
                <input
                  type="hidden"
                  name="status"
                  value={group.status === "resolved" ? "open" : "resolved"}
                />
                <button
                  type="submit"
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-content-muted transition-colors hover:bg-content-primary/5 hover:text-content-secondary"
                >
                  {group.status === "resolved" ? "Reopen" : "Resolve"}
                </button>
              </form>
            )}
            {statusAction && group.status !== "silenced" && (
              <form action={statusAction} className="shrink-0">
                <input type="hidden" name="fingerprint" value={group.fingerprint} />
                <input type="hidden" name="status" value="silenced" />
                <button
                  type="submit"
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-content-muted transition-colors hover:bg-content-primary/5 hover:text-content-secondary"
                >
                  Silence
                </button>
              </form>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
