"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { IconGitPullRequest } from "@tabler/icons-react";
import { staggerContainer, fadeSlideUp } from "@/lib/motion";
import { EmptyState } from "./empty-state";
import { relativeTime } from "@/lib/relative-time";
import { SeverityStripe } from "@/components/ui/severity-stripe";

export interface ActivityItem {
  id: string;
  repositoryName: string;
  prNumber: number;
  createdAt: string;
  riskLevel: string;
}

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

export function ActivityList({ reviews }: { reviews: ActivityItem[] }) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={<IconGitPullRequest className="w-6 h-6" />}
        title="No reviews yet"
        description="Reviews will appear here as pull requests are analyzed."
      />
    );
  }

  return (
    <motion.div className="flex flex-col" variants={staggerContainer} initial="hidden" animate="show">
      {reviews.map((review) => (
        <motion.div key={review.id} variants={fadeSlideUp}>
          <Link
            href={`/reviews/${review.id}`}
            className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-content-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
          >
            <SeverityStripe risk={review.riskLevel} />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-content-primary">{review.repositoryName}</span>
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-content-muted">PR #{review.prNumber}</span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${riskBadgeClasses(review.riskLevel)}`}
            >
              {review.riskLevel}
            </span>
            <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-content-muted">
              {relativeTime(new Date(review.createdAt), new Date())}
            </span>
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
