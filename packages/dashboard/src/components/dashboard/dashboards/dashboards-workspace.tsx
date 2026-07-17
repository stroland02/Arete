"use client";

import { useState } from "react";
import type { DashboardsViewModel } from "@/lib/queries";
import { ReviewActivityPreset } from "./presets/review-activity";
import { FindingsPreset } from "./presets/findings";
import { TelemetryPreset } from "./presets/telemetry";
import { TimeRangeControl, type Range } from "./time-range-control";
import { DashboardStatusBanner, type BannerVariant } from "./dashboard-connect-banner";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

/** Zero-valued model that renders the dashboard LAYOUT for the not-connected
 *  preview — every widget draws a structural skeleton, never fabricated data. */
const EMPTY_MODEL: Model = {
  hasAccess: true,
  totalPrs: 0,
  criticalBugs: 0,
  recentReviews: 0,
  weeklyDelta: 0,
  reviewDates: [],
  byCategory: [],
  bySeverity: [],
  byRisk: [],
  byRepo: [],
  latestReviews: [],
  telemetry: [],
  connectedProviders: [],
  repos: [],
  modelConnected: false,
};

const PRESETS = [
  { key: "activity", label: "Review Activity", Component: ReviewActivityPreset },
  { key: "findings", label: "Findings", Component: FindingsPreset },
  { key: "telemetry", label: "Telemetry", Component: TelemetryPreset },
] as const;

export function DashboardsWorkspace({ model }: { model: DashboardsViewModel }) {
  const [tab, setTab] = useState<(typeof PRESETS)[number]["key"]>("activity");
  const [range, setRange] = useState<Range>(30);
  const Active = PRESETS.find((p) => p.key === tab)!.Component;

  const connected = model.hasAccess;
  const data: Model = model.hasAccess ? model : EMPTY_MODEL;

  // Skeleton + banner are decided per active tab against that tab's own data.
  let skeleton: boolean;
  let banner: BannerVariant | null;
  if (tab === "telemetry") {
    skeleton = data.telemetry.length === 0;
    banner = skeleton ? "connect-service" : null;
  } else {
    skeleton = data.totalPrs === 0; // no reviews yet (whether or not a repo is linked)
    banner = !connected ? "connect-repository" : data.totalPrs === 0 ? "awaiting-review" : null;
  }

  return (
    <div className="space-y-6">
      {/* Connected sources — the staging state. A connected account always shows
          what it's wired to (repos, model, telemetry), even before any review
          runs: connected-but-idle is populated, never blank. */}
      {connected && (
        <div className="flex flex-wrap items-center gap-2">
          {data.repos.map((fullName) => (
            <span
              key={fullName}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent-success/25 bg-accent-success/10 px-2.5 py-1 font-mono text-[11px] text-content-secondary"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent-success" aria-hidden />
              {fullName}
            </span>
          ))}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
              data.modelConnected
                ? "border-accent-success/25 bg-accent-success/10 text-content-secondary"
                : "border-border-default bg-surface-1 text-content-muted"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${data.modelConnected ? "bg-accent-success" : "bg-content-muted/40"}`}
              aria-hidden
            />
            {data.modelConnected ? "AI model connected" : "No AI model yet"}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
              data.connectedProviders.length > 0
                ? "border-accent-success/25 bg-accent-success/10 text-content-secondary"
                : "border-border-default bg-surface-1 text-content-muted"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${data.connectedProviders.length > 0 ? "bg-accent-success" : "bg-content-muted/40"}`}
              aria-hidden
            />
            {data.connectedProviders.length > 0
              ? `Telemetry: ${data.connectedProviders.join(", ")}`
              : "No telemetry sources yet"}
          </span>
        </div>
      )}
      {banner && <DashboardStatusBanner variant={banner} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setTab(p.key)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === p.key ? "border border-border-default bg-content-primary/10 text-content-primary" : "text-content-muted hover:text-content-secondary hover:bg-content-primary/[0.03]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {tab === "activity" && !skeleton && <TimeRangeControl value={range} onChange={setRange} />}
      </div>
      <Active model={data} days={range} skeleton={skeleton} />
    </div>
  );
}
