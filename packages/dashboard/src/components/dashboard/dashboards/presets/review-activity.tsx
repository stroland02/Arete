import type { DashboardsViewModel } from "@/lib/queries";
import { IconGitPullRequest, IconClockHour4 } from "@tabler/icons-react";
import { MetricWidget } from "../metric-widget";
import { TimeseriesWidget } from "../timeseries-widget";
import { BarBreakdownWidget } from "../bar-breakdown-widget";
import { TableWidget } from "../table-widget";
import type { ConnectKind } from "../connect-prompt";

type Model = Extract<DashboardsViewModel, { hasAccess: true }>;

export function ReviewActivityPreset({ model, days, connected }: { model: Model; days: number; connected: boolean }) {
  const connect: ConnectKind | undefined = connected ? undefined : "repository";
  const weekChange = model.weeklyDelta === 0 ? undefined : `${model.weeklyDelta > 0 ? "+" : ""}${model.weeklyDelta}`;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <TimeseriesWidget title="Reviews over time" caption={connected ? `last ${days} days` : undefined} dates={model.reviewDates} days={days} connect={connect} />
      </div>
      <MetricWidget label="Pull requests reviewed" value={model.totalPrs} icon={<IconGitPullRequest className="h-5 w-5 text-accent-primary" />} connect={connect} />
      <MetricWidget label="Reviews this week" value={model.recentReviews} icon={<IconClockHour4 className="h-5 w-5 text-accent-secondary" />} change={connected ? weekChange : undefined} positive={model.weeklyDelta >= 0} connect={connect} />
      <BarBreakdownWidget title="Activity by repository" data={model.byRepo.map((r) => ({ category: r.fullName, count: r.count }))} connect={connect} />
      <TableWidget title="Recent reviews" reviews={model.latestReviews} connect={connect} />
    </div>
  );
}
