import { IconBug, IconGitPullRequest, IconCalendarStats, IconArrowUpRight } from "@tabler/icons-react";
import { CountUpValue } from "./count-up-value";
import { Sparkline } from "./sparkline";

/**
 * The reciprocity header (Noiro / SuperLog / Tsenta-inspired: quiet and
 * confident — no oversized display headline). A slim greeting line, then
 * three clean value cards that carry the "what Areté caught for you" story.
 * Every number is real (from getDashboardViewModel); nothing is fabricated.
 */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const dateLabel = () =>
  new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

export function ValueLedger({
  criticalBugs,
  totalPrs,
  recentReviews,
  weeklyDelta,
  totalPrsTrend,
  reviewsThisWeekTrend,
}: {
  criticalBugs: number;
  totalPrs: number;
  recentReviews: number;
  weeklyDelta: number;
  totalPrsTrend: number[];
  reviewsThisWeekTrend: number[];
}) {
  return (
    <div className="space-y-5">
      {/* Slim, quiet greeting — no oversized headline */}
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-content-primary">
          {greeting()}
          <span className="text-content-muted font-normal"> — here&apos;s what Areté handled for you</span>
        </h1>
        <span className="hidden sm:block text-xs text-content-muted">{dateLabel()}</span>
      </div>

      {/* Three clean, equal-weight value cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ValueCard
          icon={<IconBug className="w-4.5 h-4.5 text-accent-danger" />}
          label="Critical issues caught"
          value={criticalBugs.toString()}
          outcome="before they reached production"
          accentDot="bg-accent-danger"
        />
        <ValueCard
          icon={<IconGitPullRequest className="w-4.5 h-4.5 text-accent-primary" />}
          label="Pull requests reviewed"
          value={totalPrs.toString()}
          outcome="automatically, for your team"
          trend={totalPrsTrend}
          accent="stroke-accent-primary"
          accentDot="bg-accent-primary"
        />
        <ValueCard
          icon={<IconCalendarStats className="w-4.5 h-4.5 text-accent-info" />}
          label="Reviews this week"
          value={recentReviews.toString()}
          outcome={`${weeklyDelta >= 0 ? "+" : ""}${weeklyDelta} vs last week`}
          trend={reviewsThisWeekTrend}
          accent="stroke-accent-info"
          accentDot="bg-accent-info"
          delta={weeklyDelta}
        />
      </div>
    </div>
  );
}

function ValueCard({
  icon,
  label,
  value,
  outcome,
  trend,
  accent,
  accentDot,
  delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  outcome: string;
  trend?: number[];
  accent?: string;
  accentDot: string;
  delta?: number;
}) {
  return (
    <div className="glass-panel p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className={`h-1.5 w-1.5 rounded-full ${accentDot}`} />
        <span className="text-[13px] font-medium text-content-muted">{label}</span>
      </div>

      <div className="flex items-end justify-between gap-3">
        <span className="text-[2.75rem] leading-none font-semibold text-content-primary font-mono tabular-nums tracking-tight">
          <CountUpValue value={value} />
        </span>
        {trend && trend.length > 1 ? (
          <Sparkline data={trend} className="w-20 h-8 shrink-0 opacity-80" strokeClassName={accent} />
        ) : (
          <span className="opacity-70">{icon}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {typeof delta === "number" && delta > 0 && (
          <IconArrowUpRight className="w-3.5 h-3.5 text-accent-success shrink-0" />
        )}
        <p className="text-xs text-content-muted">{outcome}</p>
      </div>
    </div>
  );
}
