"use client";

import { useState } from "react";
import { IncidentList } from "./incident-list";
import { ErrorList } from "./error-list";
import { NewInvestigationDialog } from "./new-investigation-dialog";
import { setErrorStatusAction } from "@/app/(dashboard)/incidents/actions";
import type { IncidentView } from "@/lib/incidents";
import type { ErrorGroupView, ErrorStatus } from "@/lib/errors";

/**
 * The Incidents workspace hosts the two halves of the same story:
 *
 *  - **Errors** — the list of individual recurring errors (one row per
 *    fingerprint), each showing which incident it is connected to.
 *  - **Incidents** — the groupings of those errors that get resolved all at
 *    once, with the Open / Resolved / Noise / All triage inbox.
 *
 * Both views filter client-side over rows the server already handed us (already
 * tenant-scoped by getIncidents / getErrorGroups) — no per-tab refetch, so
 * switching is instant. Empty tabs show an honest per-filter empty state; no
 * fabricated rows.
 *
 * Noise is a real human-triage classification (Incident.noisedAt), set from an
 * incident's detail page and orthogonal to Alertmanager's firing/resolved. New
 * investigation opens a real manual incident via a server action.
 *
 * `errors === null` means the error surface is UNAVAILABLE for this account
 * (error events are Kuma's own self-telemetry, gated to the platform
 * installation). We say exactly that — we never render an "all clear" that
 * would imply zero errors when we simply cannot show them.
 */

type View = "incidents" | "errors";

type Filter = "open" | "resolved" | "noise" | "all";

type ErrorFilter = ErrorStatus | "all";

const VIEWS: { id: View; label: string }[] = [
  { id: "incidents", label: "Incidents" },
  { id: "errors", label: "Errors" },
];

const TABS: { id: Filter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
  { id: "noise", label: "Noise" },
  { id: "all", label: "All" },
];

const ERROR_TABS: { id: ErrorFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "observing", label: "Observing" },
  { id: "resolved", label: "Resolved" },
  { id: "silenced", label: "Silenced" },
  { id: "all", label: "All" },
];

const EMPTY_LABEL: Record<Filter, string> = {
  open: "No open incidents",
  resolved: "No resolved incidents",
  noise: "No incidents marked as noise",
  all: "No incidents yet",
};

const ERROR_EMPTY_TITLE: Record<ErrorFilter, string> = {
  open: "No open errors",
  observing: "No errors being observed",
  resolved: "No resolved errors",
  silenced: "No silenced errors",
  all: "No errors recorded",
};

const ERROR_EMPTY_DESCRIPTION: Record<ErrorFilter, string> = {
  open: "Errors that are still recurring will appear here.",
  observing: "Errors you have put under observation will appear here.",
  resolved: "Errors closed out — on their own or with their incident — appear here.",
  silenced: "Errors you have silenced will appear here.",
  all: "Recurring exceptions and error logs will appear here as they are recorded.",
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

/** Exported so the partitioning can be tested without driving the tab UI. */
export function matchesErrorFilter(group: ErrorGroupView, filter: ErrorFilter): boolean {
  return filter === "all" ? true : group.status === filter;
}

export function IncidentsWorkspace({
  incidents,
  installationId,
  errors = null,
  initialView = "incidents",
}: {
  incidents: IncidentView[];
  installationId: string | null;
  /** `null` = the error surface is unavailable for this account. */
  errors?: ErrorGroupView[] | null;
  /** Which of the two views opens first. */
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [filter, setFilter] = useState<Filter>("open");
  const [errorFilter, setErrorFilter] = useState<ErrorFilter>("open");

  const visible = incidents.filter((incident) => matchesFilter(incident, filter));
  const visibleErrors = (errors ?? []).filter((group) => matchesErrorFilter(group, errorFilter));

  return (
    <div className="space-y-4">
      {/* Top-level view switch: the individual errors, or the incidents that
          group them. */}
      <div className="flex items-center gap-1" role="tablist" aria-label="Incidents view">
        {VIEWS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={view === option.id}
            onClick={() => setView(option.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              view === option.id
                ? "bg-surface-2 text-content-primary"
                : "text-content-muted hover:text-content-secondary"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {view === "incidents" ? (
        <>
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
        </>
      ) : errors === null ? (
        // Unavailable — NOT "all clear". Never imply zero errors when we simply
        // cannot show them for this account.
        <div className="rounded-2xl border border-border-default bg-surface-1 px-6 py-10">
          <p className="text-sm font-medium text-content-secondary">
            Errors aren&apos;t available for this account yet
          </p>
          <p className="mt-2 max-w-xl text-sm text-content-muted">
            The error groups shown here come from Kuma&apos;s own service telemetry, which is
            currently recorded only for the platform installation. This is not an all-clear —
            we can&apos;t say whether your installation has errors, so we don&apos;t.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-default pt-4">
            <div className="flex items-center gap-1" role="tablist" aria-label="Error status">
              {ERROR_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={errorFilter === tab.id}
                  onClick={() => setErrorFilter(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    errorFilter === tab.id
                      ? "bg-surface-2 text-content-primary"
                      : "text-content-muted hover:text-content-secondary"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <span className="text-xs tabular-nums text-content-muted">
              {visibleErrors.length} {visibleErrors.length === 1 ? "error" : "errors"}
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border-default bg-surface-1 p-2">
            <ErrorList
              errors={visibleErrors}
              statusAction={setErrorStatusAction}
              emptyTitle={ERROR_EMPTY_TITLE[errorFilter]}
              emptyDescription={ERROR_EMPTY_DESCRIPTION[errorFilter]}
            />
          </div>
        </>
      )}
    </div>
  );
}
