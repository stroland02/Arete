"use client";

import { useState } from "react";
import type { DashboardsViewModel } from "@/lib/queries";
import { ReviewActivityPreset } from "./presets/review-activity";
import { FindingsPreset } from "./presets/findings";
import { TelemetryPreset } from "./presets/telemetry";
import { TimeRangeControl, type Range } from "./time-range-control";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

/** Zero-valued model used to render the dashboard LAYOUT in the not-connected
 *  preview — every widget shows a "connect …" prompt (see ConnectPrompt),
 *  never fabricated data. */
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

  return (
    <div className="space-y-6">
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
        {connected && tab === "activity" && <TimeRangeControl value={range} onChange={setRange} />}
      </div>
      <Active model={data} days={range} connected={connected} />
    </div>
  );
}
