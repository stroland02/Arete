import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getReviewHistory, resolveSelectedInstallationIds } from "@/lib/queries";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { IconGitPullRequest } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

const RISK_TABS = ["all", "critical", "high", "medium", "low"] as const;
type RiskTab = (typeof RISK_TABS)[number];

function riskBadgeClasses(riskLevel: string): string {
  switch (riskLevel.toLowerCase()) {
    case "critical":
    case "high":
      return "bg-accent-danger/10 text-accent-danger border-accent-danger/25";
    case "medium":
      return "bg-accent-warning/10 text-accent-warning border-accent-warning/25";
    case "low":
      return "bg-accent-success/10 text-accent-success border-accent-success/25";
    default:
      return "bg-content-primary/5 text-content-muted border-border-default";
  }
}

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

export default async function ReviewHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string; risk?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { installation, risk, page: pageParam } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], installation);

  const activeTab: RiskTab = RISK_TABS.includes(risk as RiskTab) ? (risk as RiskTab) : "all";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const riskLevel = activeTab === "all" ? undefined : activeTab;

  const { reviews, total, riskCounts } = await getReviewHistory(db, installationIds, { riskLevel, page });
  const totalAll = Object.values(riskCounts).reduce((a, b) => a + b, 0);
  const totalPages = Math.max(1, Math.ceil((riskLevel ? (riskCounts[riskLevel] ?? 0) : totalAll) / 20));

  function tabHref(tab: RiskTab): string {
    const params = new URLSearchParams();
    if (installation) params.set("installation", installation);
    if (tab !== "all") params.set("risk", tab);
    const qs = params.toString();
    return qs ? `/history?${qs}` : "/history";
  }

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (installation) params.set("installation", installation);
    if (activeTab !== "all") params.set("risk", activeTab);
    params.set("page", targetPage.toString());
    return `/history?${params.toString()}`;
  }

  return (
    <PageReveal className="mx-auto max-w-5xl space-y-6">
      <RevealItem>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-content-primary">Review History</h1>
          <p className="text-sm text-content-muted">Every pull request Kuma has reviewed, most recent first.</p>
        </div>
      </RevealItem>

      <RevealItem>
        <div className="flex items-center gap-1.5 border-b border-border-subtle pb-3 overflow-x-auto">
          {RISK_TABS.map((tab) => {
            const count = tab === "all" ? totalAll : riskCounts[tab] ?? 0;
            const isActive = tab === activeTab;
            return (
              <Link
                key={tab}
                href={tabHref(tab)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-content-primary/10 text-content-primary border border-border-default"
                    : "text-content-muted hover:text-content-secondary hover:bg-content-primary/[0.03]"
                }`}
              >
                {tab === "all" ? "All" : tab.charAt(0).toUpperCase() + tab.slice(1)}{" "}
                <span className="text-content-muted">{count}</span>
              </Link>
            );
          })}
        </div>
      </RevealItem>

      <RevealItem>
        {reviews.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconGitPullRequest className="w-6 h-6" />}
              title="No reviews yet"
              description="Reviews will appear here as pull requests are analyzed."
            />
          </Card>
        ) : (
          <Card className="divide-y divide-border-subtle p-0 overflow-hidden">
            {reviews.map((review) => (
              <Link
                key={review.id}
                href={`/reviews/${review.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-content-primary/[0.03] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-content-secondary font-mono truncate">
                    {review.repositoryFullName}
                  </p>
                  <p className="text-xs text-content-muted mt-0.5">
                    <span className="font-mono tabular-nums">PR #{review.prNumber}</span> • {timeAgo(new Date(review.createdAt))}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide border shrink-0 ${riskBadgeClasses(review.riskLevel)}`}
                >
                  {review.riskLevel}
                </span>
              </Link>
            ))}
          </Card>
        )}
      </RevealItem>

      {totalPages > 1 && (
        <RevealItem>
          <div className="flex items-center justify-between">
            <Link
              href={pageHref(page - 1)}
              aria-disabled={page <= 1}
              className={`text-sm ${page <= 1 ? "text-content-muted/40 pointer-events-none" : "text-content-secondary hover:text-content-primary"}`}
            >
              ← Previous
            </Link>
            <span className="text-xs text-content-muted">
              Page {page} of {totalPages} · {total} total
            </span>
            <Link
              href={pageHref(page + 1)}
              aria-disabled={page >= totalPages}
              className={`text-sm ${page >= totalPages ? "text-content-muted/40 pointer-events-none" : "text-content-secondary hover:text-content-primary"}`}
            >
              Next →
            </Link>
          </div>
        </RevealItem>
      )}
    </PageReveal>
  );
}
