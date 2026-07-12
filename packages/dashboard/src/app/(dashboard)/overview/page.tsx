import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getDashboardViewModel,
  getTrendSeries,
  resolveSelectedInstallationIds,
} from "@/lib/queries";
import Link from "next/link";
import { bucketByDay, cumulativeByDay } from "@/lib/trends";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { ValueLedger } from "@/components/dashboard/value-ledger";
import { ConnectorHealthStrip } from "@/components/dashboard/connector-health-strip";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityList } from "@/components/dashboard/activity-list";
import { MetricsGrid, type Metric } from "@/components/dashboard/metrics-grid";
import { CommentsByCategory } from "@/components/dashboard/comments-by-category";
import {
  IconBug,
  IconCalendarStats,
  IconFolders,
  IconGitPullRequest,
} from "@tabler/icons-react";

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

  const [viewModel, trendSeries] = await Promise.all([
    getDashboardViewModel(db, installationIds),
    getTrendSeries(db, installationIds),
  ]);

  // Don't wall the whole dashboard behind "install the GitHub App". A
  // signed-in user always sees the real overview; when no installation is
  // linked yet we render it in a zero-state and show a non-blocking banner
  // that points to the Connections page (where the GitHub App is connected).
  const connected = viewModel.hasAccess;
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
  } = viewModel.hasAccess
    ? viewModel
    : {
        totalPrs: 0,
        activeRepos: 0,
        criticalBugs: 0,
        recentReviews: 0,
        weeklyDelta: 0,
        totalPrsChange: { change: "+0", positive: true },
        criticalBugsChange: { change: "+0", positive: true },
        repoDelta: 0,
        commentsByCategory: [],
        latestReviews: [],
      };

  // Trends are derived from real createdAt data via getTrendSeries — never
  // fabricated. "Critical Bugs Prevented" deliberately has no sparkline:
  // scoped out of this port (see docs/superpowers/specs/2026-07-11-dashboard-ui-port-design.md
  // §3.2) even though ReviewComment now has a createdAt column on main.
  const totalPrsTrend = cumulativeByDay(trendSeries.reviewDates, 7);
  const reviewsThisWeekTrend = bucketByDay(trendSeries.reviewDates, 7);
  const activeReposTrend = cumulativeByDay(trendSeries.repoDates, 7);

  // SuperLog-style analytics grid — every value and weekly change comes from
  // the view model (real Prisma aggregations), every sparkline from real
  // createdAt series. "Critical Issues Caught" deliberately has no sparkline
  // (see the trend comment above).
  const metrics: Metric[] = [
    {
      title: "Total PRs Reviewed",
      value: totalPrs.toString(),
      change: totalPrsChange.change,
      positive: totalPrsChange.positive,
      icon: <IconGitPullRequest className="h-5 w-5 text-accent-primary" />,
      trend: totalPrsTrend,
    },
    {
      title: "Critical Issues Caught",
      value: criticalBugs.toString(),
      change: criticalBugsChange.change,
      positive: criticalBugsChange.positive,
      icon: <IconBug className="h-5 w-5 text-accent-danger" />,
    },
    {
      title: "Reviews This Week",
      value: recentReviews.toString(),
      change: `${weeklyDelta >= 0 ? "+" : ""}${weeklyDelta}`,
      positive: weeklyDelta >= 0,
      icon: <IconCalendarStats className="h-5 w-5 text-accent-info" />,
      trend: reviewsThisWeekTrend,
    },
    {
      title: "Active Repositories",
      value: activeRepos.toString(),
      change: `${repoDelta >= 0 ? "+" : ""}${repoDelta}`,
      positive: repoDelta >= 0,
      icon: <IconFolders className="h-5 w-5 text-accent-success" />,
      trend: activeReposTrend,
    },
  ];

  return (
    <PageReveal className="space-y-8">
      {!connected && (
        <RevealItem>
          <div className="glass-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-content-primary">
                Connect a repository to see your real reviews
              </h2>
              <p className="mt-0.5 text-xs text-content-muted">
                You&apos;re signed in, but no GitHub repository is connected yet. Connect the Areté
                GitHub App on the Connections page — this overview then fills with your PRs,
                findings, and agent activity.
              </p>
            </div>
            <Link
              href="/connections"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/30"
            >
              Go to Connections
            </Link>
          </div>
        </RevealItem>
      )}

      {/* ① Reciprocity hero — what Areté caught FOR you */}
      <RevealItem>
        <ValueLedger
          criticalBugs={criticalBugs}
          totalPrs={totalPrs}
          recentReviews={recentReviews}
          weeklyDelta={weeklyDelta}
          totalPrsTrend={totalPrsTrend}
          reviewsThisWeekTrend={reviewsThisWeekTrend}
        />
      </RevealItem>

      {/* ② Analytics grid — the agents block moved to /agents; this row is
          the SuperLog-style breakdown with weekly changes and sparklines */}
      <MetricsGrid metrics={metrics} />

      {/* ③ Two-column analytics: category breakdown + what-we-caught feed */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        <RevealItem>
          <CommentsByCategory categories={commentsByCategory} />
        </RevealItem>
        <RevealItem>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>What we caught for you</CardTitle>
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
      </div>

      {/* ④ Compounding-value loop: connect more tools → richer reviews (full width) */}
      <RevealItem>
        <ConnectorHealthStrip />
      </RevealItem>
    </PageReveal>
  );
}
