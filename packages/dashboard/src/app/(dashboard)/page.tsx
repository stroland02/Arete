import { IconChartBar, IconBug, IconCalendarStats, IconActivity } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { db } from "../../lib/db";
import {
  getConnectedTelemetryProviders,
  getDashboardViewModel,
  getTrendSeries,
  resolveSelectedInstallationIds,
} from "../../lib/queries";
import { bucketByDay, cumulativeByDay } from "../../lib/trends";
import { EmptyState } from "../../components/EmptyState";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { MetricsGrid, type Metric } from "@/components/dashboard/metrics-grid";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityList } from "@/components/dashboard/activity-list";
import { AgentOrchestrationGraph } from "@/components/dashboard/agent-orchestration-graph";

// This page reads the session and queries Prisma scoped to it on every
// request — it must never be statically prerendered (that would either fail
// at build time for lack of a session, or worse, bake one user's tenant
// data into a page served to everyone). `force-dynamic` makes that explicit
// instead of relying on Next's heuristics.
export const dynamic = "force-dynamic";

export default async function DashboardOverview({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { installation } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(
    session.installations ?? [],
    installation
  );

  const [viewModel, trendSeries, telemetryProviders] = await Promise.all([
    getDashboardViewModel(db, installationIds),
    getTrendSeries(db, installationIds),
    getConnectedTelemetryProviders(db, installationIds),
  ]);

  if (!viewModel.hasAccess) {
    return <EmptyState />;
  }

  const {
    totalPrs,
    activeRepos,
    criticalBugs,
    recentReviews,
    weeklyDelta,
    totalPrsChange,
    criticalBugsChange,
    repoDelta,
    commentsByCategory,
    latestReviews,
  } = viewModel;

  // Trends are derived from real createdAt data via getTrendSeries — never
  // fabricated. "Critical Bugs Prevented" deliberately has no sparkline:
  // scoped out of this port (see docs/superpowers/specs/2026-07-11-dashboard-ui-port-design.md
  // §3.2) even though ReviewComment now has a createdAt column on main.
  const totalPrsTrend = cumulativeByDay(trendSeries.reviewDates, 7);
  const reviewsThisWeekTrend = bucketByDay(trendSeries.reviewDates, 7);
  const activeReposTrend = cumulativeByDay(trendSeries.repoDates, 7);

  const metrics: Metric[] = [
    {
      title: "Total PRs Reviewed",
      value: totalPrs.toString(),
      change: totalPrsChange.change,
      positive: totalPrsChange.positive,
      icon: <IconChartBar className="w-6 h-6 text-accent-primary" />,
      trend: totalPrsTrend,
    },
    {
      title: "Critical Bugs Prevented",
      value: criticalBugs.toString(),
      change: criticalBugsChange.change,
      positive: criticalBugsChange.positive,
      icon: <IconBug className="w-6 h-6 text-accent-success" />,
    },
    {
      title: "Reviews This Week",
      value: recentReviews.toString(),
      change: `${weeklyDelta >= 0 ? "+" : ""}${weeklyDelta} vs last week`,
      positive: weeklyDelta >= 0,
      icon: <IconCalendarStats className="w-6 h-6 text-accent-info" />,
      trend: reviewsThisWeekTrend,
    },
    {
      title: "Active Repositories",
      value: activeRepos.toString(),
      change: `${repoDelta >= 0 ? "+" : ""}${repoDelta}`,
      positive: repoDelta >= 0,
      icon: <IconActivity className="w-6 h-6 text-accent-secondary" />,
      trend: activeReposTrend,
    },
  ];

  return (
    <PageReveal className="space-y-8">
      <RevealItem>
        <h1 className="text-2xl font-semibold text-content-primary">Overview</h1>
      </RevealItem>

      <MetricsGrid metrics={metrics} />

      <RevealItem className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Agent Orchestration</CardTitle>
            <button
              disabled
              title="Review history coming soon"
              className="text-sm text-content-muted font-medium opacity-60 cursor-not-allowed"
            >
              View All
            </button>
          </CardHeader>
          <AgentOrchestrationGraph
            totalPrs={totalPrs}
            commentsByCategory={commentsByCategory}
            telemetryProviders={telemetryProviders}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest Activity</CardTitle>
          </CardHeader>
          <ActivityList
            reviews={latestReviews.map((review) => ({
              id: review.id,
              repositoryName: review.repositoryFullName,
              prNumber: review.prNumber,
              createdAt: review.createdAt.toISOString(),
              riskLevel: review.riskLevel,
            }))}
          />
        </Card>
      </RevealItem>
    </PageReveal>
  );
}
