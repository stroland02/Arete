import { IconChartBar, IconBug, IconCalendarStats, IconActivity } from "@tabler/icons-react";
import { db } from "../lib/db";

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

/**
 * Week-over-week change badge. Expresses the delta as a percentage of the
 * prior-week baseline; falls back to a raw count when the baseline is 0 to
 * avoid divide-by-zero rendering as "Infinity%" / "NaN%".
 */
function weeklyChange(current: number, prior: number): { change: string; positive: boolean } {
  const delta = current - prior;
  const positive = delta >= 0;
  const sign = positive ? "+" : "";
  if (prior === 0) {
    return { change: `${sign}${delta}`, positive };
  }
  return { change: `${sign}${((delta / prior) * 100).toFixed(1)}%`, positive };
}

export default async function DashboardOverview() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [
    totalPrs,
    activeRepos,
    criticalBugs,
    recentReviews,
    previousWeekReviews,
    priorTotalPrs,
    priorCriticalBugs,
    priorActiveRepos,
    commentsByCategory,
    latestReviews,
  ] =
    await Promise.all([
      db.review.count(),
      db.repository.count(),
      db.reviewComment.count({ where: { severity: "error" } }),
      db.review.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      db.review.count({ where: { createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } } }),
      db.review.count({ where: { createdAt: { lt: sevenDaysAgo } } }),
      // ReviewComment has no createdAt of its own; comments are created with their review.
      db.reviewComment.count({ where: { severity: "error", review: { createdAt: { lt: sevenDaysAgo } } } }),
      db.repository.count({ where: { createdAt: { lt: sevenDaysAgo } } }),
      db.reviewComment.groupBy({
        by: ["category"],
        _count: { category: true },
        orderBy: { _count: { category: "desc" } },
      }),
      db.review.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: { repository: true },
      }),
    ]);

  const weeklyDelta = recentReviews - previousWeekReviews;
  const totalPrsChange = weeklyChange(totalPrs, priorTotalPrs);
  const criticalBugsChange = weeklyChange(criticalBugs, priorCriticalBugs);
  // Repo counts are small; a raw week-over-week delta reads better than a percentage.
  const repoDelta = activeRepos - priorActiveRepos;
  const maxCategoryCount = Math.max(1, ...commentsByCategory.map((c) => c._count.category));

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
                      style={{ width: `${(entry._count.category / maxCategoryCount) * 100}%` }}
                    />
                  </div>
                  <p className="w-10 shrink-0 text-right text-sm font-semibold text-slate-200">
                    {entry._count.category}
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
                    <p className="text-sm font-medium text-slate-200 truncate">{review.repository.fullName}</p>
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
