"use client";

import { useState } from "react";
import { IncidentList } from "./incident-list";
import { NewInvestigationDialog } from "./new-investigation-dialog";
import type { IncidentView } from "@/lib/incidents";

/**
 * The Incidents workspace: the incident inbox with Open / Resolved / Noise /
 * All filters over the caller's REAL incidents (already tenant-scoped by
 * getIncidents). Filtering is client-side over the rows the server handed us —
 * no per-tab refetch — so switching tabs is instant. Empty tabs show an honest
 * per-filter empty state; no fabricated rows.
 *
 * Noise is a real human-triage classification (Incident.noisedAt), set from an
 * incident's detail page and orthogonal to Alertmanager's firing/resolved. New
 * investigation opens a real manual incident via a server action.
 */

type Filter = "open" | "resolved" | "noise" | "all";

const TABS: { id: Filter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
  { id: "noise", label: "Noise" },
  { id: "all", label: "All" },
];

const EMPTY_LABEL: Record<Filter, string> = {
  open: "No open incidents",
  resolved: "No resolved incidents",
  noise: "No incidents marked as noise",
  all: "No incidents yet",
};

function matchesFilter(incident: IncidentView, filter: Filter): boolean {
  switch (filter) {
    case "open":
      // Open = actively firing and NOT triaged as noise.
      return incident.status === "firing" && !incident.noisedAt;
    case "resolved":
      // Resolved = alert cleared and NOT triaged as noise.
      return incident.status === "resolved" && !incident.noisedAt;
    case "noise":
      // Noise = a human marked it non-actionable, whatever its firing state.
      return incident.noisedAt !== null;
    case "all":
      return true;
  }
}

export function IncidentsWorkspace({
  incidents,
  installationId,
}: {
  incidents: IncidentView[];
  installationId: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const visible = incidents.filter((incident) => matchesFilter(incident, filter));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-default pt-4">
        <div className="flex items-center gap-1" role="tablist" aria-label="Incident status">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              onClick={() => setFilter(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === tab.id
                  ? "bg-surface-2 text-content-primary"
                  : "text-content-muted hover:text-content-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs tabular-nums text-content-muted">
            {visible.length} {visible.length === 1 ? "incident" : "incidents"}
          </span>
          <NewInvestigationDialog installationId={installationId} />
        </div>
      </div>

      {visible.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border-default bg-surface-1 p-2">
          <IncidentList incidents={visible} />
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-2xl border border-border-default bg-surface-1 px-6 py-20">
          <p className="text-sm text-content-muted">{EMPTY_LABEL[filter]}</p>
        </div>
      )}
    </div>
  );
}
