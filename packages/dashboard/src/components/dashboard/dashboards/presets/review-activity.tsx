import type { DashboardsViewModel } from "@/lib/queries";
import { IconGitPullRequest, IconClockHour4 } from "@tabler/icons-react";
import { MetricWidget } from "../metric-widget";
import { TimeseriesWidget } from "../timeseries-widget";
import { BarBreakdownWidget } from "../bar-breakdown-widget";
import { TableWidget } from "../table-widget";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

export function ReviewActivityPreset({ model, days, skeleton }: { model: Model; days: number; skeleton: boolean }) {
  const weekChange = model.weeklyDelta === 0 ? undefined : `${model.weeklyDelta > 0 ? "+" : ""}${model.weeklyDelta}`;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <TimeseriesWidget title="Reviews over time" caption={skeleton ? undefined : `last ${days} days`} dates={model.reviewDates} days={days} skeleton={skeleton} />
      </div>
      <MetricWidget label="Pull requests reviewed" value={model.totalPrs} icon={<IconGitPullRequest className="h-5 w-5 text-accent-primary" />} skeleton={skeleton} />
      <MetricWidget label="Reviews this week" value={model.recentReviews} icon={<IconClockHour4 className="h-5 w-5 text-accent-secondary" />} change={skeleton ? undefined : weekChange} positive={model.weeklyDelta >= 0} skeleton={skeleton} />
      <BarBreakdownWidget title="Activity by repository" data={model.byRepo.map((r) => ({ category: r.fullName, count: r.count }))} skeleton={skeleton} />
      <TableWidget title="Recent reviews" reviews={model.latestReviews} skeleton={skeleton} />
    </div>
  );
}
