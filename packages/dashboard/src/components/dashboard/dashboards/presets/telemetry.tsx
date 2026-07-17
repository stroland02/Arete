import type { DashboardsViewModel } from "@/lib/queries";
import { TelemetryMetricWidget } from "../telemetry-metric-widget";
import { TelemetryConnectCards } from "../telemetry-connect-cards";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

export function TelemetryPreset({ model, skeleton }: { model: Model; days: number; skeleton: boolean }) {
  if (skeleton) {
    // No telemetry connected yet: show the real, actionable connect-a-service
    // catalog rather than blank skeletons — what's connectable, drawn from
    // connector-catalog.ts.
    return <TelemetryConnectCards />;
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {model.telemetry.map((snap) => (
        <TelemetryMetricWidget key={`${snap.provider}:${snap.sourceRef}`} snapshot={snap} />
      ))}
    </div>
  );
}
