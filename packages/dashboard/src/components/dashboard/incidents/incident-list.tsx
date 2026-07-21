"use client";

import Link from "next/link";
import { IconAlertTriangle } from "@tabler/icons-react";
import { relativeTime } from "@/lib/relative-time";
import { EmptyState } from "../empty-state";
import type { IncidentView } from "@/lib/incidents";

/**
 * The Incident inbox: alerts Kuma's own monitoring fired (Prometheus →
 * Alertmanager → the receiver), rendered honestly — firing vs resolved,
 * severity, summary, and (when the incident opened a fix run) a deep link to
 * it. Mirrors ActivityList's row shape (dot · title · badges · relative time)
 * since this is the same "alert inbox" presentation pattern, just for
 * incidents instead of reviews — deliberately NOT a new layout language.
 */

function severityBadgeClasses(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-accent-danger/10 text-accent-danger border-accent-danger/25";
    case "warning":
      return "bg-accent-warning/10 text-accent-warning border-accent-warning/25";
    default:
      return "bg-content-primary/5 text-content-muted border-border-default";
  }
}

function statusDotClass(status: string): string {
  return status === "firing" ? "bg-accent-danger" : "bg-accent-success";
}

function statusBadgeClasses(status: string): string {
  return status === "firing"
    ? "bg-accent-danger/10 text-accent-danger border-accent-danger/25"
    : "bg-accent-success/10 text-accent-success border-accent-success/25";
}

export function IncidentList({ incidents }: { incidents: IncidentView[] }) {
  if (incidents.length === 0) {
    return (
      <EmptyState
        icon={<IconAlertTriangle className="w-6 h-6" />}
        title="No incidents"
        description="Alerts fired by Kuma's own monitoring will appear here."
      />
    );
  }

  return (
    <div className="flex flex-col">
      {incidents.map((incident) => (
        <div
          key={incident.id}
          className="flex flex-col gap-1 rounded-lg px-2 py-2.5 transition-colors hover:bg-content-primary/[0.04]"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(incident.status)}`}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-content-primary">
              {incident.alertName}
            </span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityBadgeClasses(incident.severity)}`}
            >
              {incident.severity}
            </span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClasses(incident.status)}`}
            >
              {incident.status}
            </span>
            <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-content-muted">
              {relativeTime(new Date(incident.startsAt), new Date())}
            </span>
          </div>
          <div className="flex items-center gap-2 pl-[18px]">
            <p className="min-w-0 flex-1 truncate text-[11px] leading-4 text-content-muted">
              {incident.summary}
            </p>
            {incident.workItemId && incident.fixContainerId && (
              <Link
                href={`/services?container=${encodeURIComponent(incident.fixContainerId)}`}
                className="shrink-0 text-[11px] font-medium text-accent-primary hover:underline"
              >
                View fix run
              </Link>
            )}
            {incident.workItemId && !incident.fixContainerId && (
              <span className="shrink-0 text-[11px] text-content-muted">Fix opened</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
