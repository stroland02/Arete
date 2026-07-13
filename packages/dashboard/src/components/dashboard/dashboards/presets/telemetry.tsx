import type { DashboardsViewModel } from "@/lib/queries";
import { TelemetryMetricWidget } from "../telemetry-metric-widget";
import { TelemetryCardSkeleton } from "../dashboard-skeletons";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

export function TelemetryPreset({ model, skeleton }: { model: Model; days: number; skeleton: boolean }) {
  if (skeleton) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TelemetryCardSkeleton />
        <TelemetryCardSkeleton />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {model.telemetry.map((snap) => (
        <TelemetryMetricWidget key={`${snap.provider}:${snap.sourceRef}`} snapshot={snap} />
      ))}
    </div>
  );
}
