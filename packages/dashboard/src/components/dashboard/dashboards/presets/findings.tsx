import type { DashboardsViewModel } from "@/lib/queries";
import { IconShieldExclamation } from "@tabler/icons-react";
import { MetricWidget } from "../metric-widget";
import { BarBreakdownWidget } from "../bar-breakdown-widget";
import { TableWidget } from "../table-widget";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

function severityColor(label: string): string {
  switch (label.toLowerCase()) {
    case "error": return "bg-accent-danger";
    case "warning": return "bg-accent-warning";
    default: return "bg-accent-primary";
  }
}
function riskColor(label: string): string {
  switch (label.toLowerCase()) {
    case "critical":
    case "high": return "bg-accent-danger";
    case "medium": return "bg-accent-warning";
    case "low": return "bg-accent-success";
    default: return "bg-content-muted";
  }
}

export function FindingsPreset({ model, connected }: { model: Model; days: number; connected: boolean }) {
  const skeleton = !connected;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <MetricWidget label="Critical issues caught" value={model.criticalBugs} icon={<IconShieldExclamation className="h-5 w-5 text-accent-danger" />} skeleton={skeleton} />
      <BarBreakdownWidget title="Findings by severity" data={model.bySeverity} colorFor={severityColor} skeleton={skeleton} />
      <BarBreakdownWidget title="Findings by category" data={model.byCategory} skeleton={skeleton} />
      <BarBreakdownWidget title="Risk-level breakdown" data={model.byRisk} colorFor={riskColor} skeleton={skeleton} />
      <div className="lg:col-span-2">
        <TableWidget title="Recent reviews" reviews={model.latestReviews} skeleton={skeleton} />
      </div>
    </div>
  );
}
