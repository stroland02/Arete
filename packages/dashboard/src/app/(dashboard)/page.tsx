import { IconChartBar, IconBug, IconCalendarStats, IconActivity } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { db } from "../../lib/db";
import { getDashboardViewModel, resolveSelectedInstallationIds } from "../../lib/queries";
import { EmptyState } from "../../components/EmptyState";

// This page reads the session and queries Prisma scoped to it on every
// request — it must never be statically prerendered (that would either fail
// at build time for lack of a session, or worse, bake one user's tenant
// data into a page served to everyone). `force-dynamic` makes that explicit
// instead of relying on Next's heuristics.
export const dynamic = "force-dynamic";

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function riskBadgeClasses(riskLevel: string): string {
  switch (riskLevel.toLowerCase()) {
    case "critical":
    case "high":
      return "bg-rose-500/10 text-rose-400 border-rose-500/20";
    case "medium":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "low":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    default:
      return "bg-slate-500/10 text-slate-400 border-slate-500/20";
  }
}

function formatCategory(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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

  const viewModel = await getDashboardViewModel(db, installationIds);

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

  const maxCategoryCount = Math.max(1, ...commentsByCategory.map((c) => c.count));

  const metrics = [
    {
      title: "Total PRs Reviewed",
      value: totalPrs.toString(),
      change: totalPrsChange.change,
      positive: totalPrsChange.positive,
      icon: <IconChartBar className="w-6 h-6 text-indigo-400" />,
    },
    {
      title: "Critical Bugs Prevented",
      value: criticalBugs.toString(),
      change: criticalBugsChange.change,
      positive: criticalBugsChange.positive,
      icon: <IconBug className="w-6 h-6 text-emerald-400" />,
    },
    {
      title: "Reviews This Week",
      value: recentReviews.toString(),
      change: `${weeklyDelta >= 0 ? "+" : ""}${weeklyDelta} vs last week`,
      positive: weeklyDelta >= 0,
      icon: <IconCalendarStats className="w-6 h-6 text-cyan-400" />,
    },
    {
      title: "Active Repositories",
      value: activeRepos.toString(),
      change: `${repoDelta >= 0 ? "+" : ""}${repoDelta}`,
      positive: repoDelta >= 0,
      icon: <IconActivity className="w-6 h-6 text-purple-400" />,
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000 ease-out">
      {/* Header section */}
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">
          Overview
        </h1>
        <p className="text-slate-400 text-lg">
          Monitor your AI-assisted code reviews and team performance in real-time.
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric, i) => (
          <div key={i} className="glass-panel p-6 flex flex-col gap-4 group">
            <div className="flex justify-between items-start">
              <div className="p-3 bg-white/5 rounded-2xl border border-white/10 group-hover:bg-white/10 transition-colors">
                {metric.icon}
              </div>
              <div className={`px-2.5 py-1 rounded-full text-xs font-medium border ${metric.positive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                {metric.change}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">{metric.title}</p>
              <h3 className="text-3xl font-bold text-white tracking-tight group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-indigo-300 transition-all">
                {metric.value}
              </h3>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-panel p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Comments by Agent</h2>
          </div>
          {commentsByCategory.length === 0 ? (
            <div className="h-64 flex items-center justify-center border border-white/5 rounded-xl bg-white/[0.02] backdrop-blur-sm">
              <p className="text-slate-500 flex items-center gap-2">
                <IconActivity className="w-5 h-5" />
                No review comments yet
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {commentsByCategory.map((entry) => (
                <div key={entry.category} className="flex items-center gap-4">
                  <p className="w-40 shrink-0 text-sm font-medium text-slate-300">
                    {formatCategory(entry.category)}
                  </p>
                  <div className="flex-1 h-2.5 rounded-full bg-white/5 border border-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
                      style={{ width: `${(entry.count / maxCategoryCount) * 100}%` }}
                    />
                  </div>
                  <p className="w-10 shrink-0 text-right text-sm font-semibold text-slate-200">
                    {entry.count}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-panel p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Latest Activity</h2>
          </div>
          <div className="space-y-4">
            {latestReviews.length === 0 && (
              <p className="text-sm text-slate-500">No reviews yet.</p>
            )}
            {latestReviews.map((review) => (
              <div key={review.id} className="flex gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-white/5">
                <div className="w-2 h-2 mt-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-200 truncate">{review.repositoryFullName}</p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border shrink-0 ${riskBadgeClasses(review.riskLevel)}`}>
                      {review.riskLevel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">PR #{review.prNumber} • {timeAgo(new Date(review.createdAt))}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
