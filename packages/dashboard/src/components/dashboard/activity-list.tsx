"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { IconGitPullRequest } from "@tabler/icons-react";
import { staggerContainer, fadeSlideUp } from "@/lib/motion";
import { EmptyState } from "./empty-state";

export interface ActivityItem {
  id: string;
  repositoryName: string;
  prNumber: number;
  createdAt: string;
  riskLevel: string;
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

// Semantic risk colors come from the accent-{danger,warning,success} tokens so
// they adapt across both themes (never a fixed light/dark hue).
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
    <motion.div className="space-y-4" variants={staggerContainer} initial="hidden" animate="show">
      {reviews.map((review) => (
        <motion.div key={review.id} variants={fadeSlideUp}>
          <Link
            href={`/reviews/${review.id}`}
            className="flex gap-4 p-3 rounded-xl hover:bg-content-primary/[0.04] transition-colors cursor-pointer border border-transparent hover:border-border-subtle"
          >
            <div className="w-2 h-2 mt-2 rounded-full bg-accent-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-content-secondary font-mono tabular-nums truncate">{review.repositoryName}</p>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border shrink-0 ${riskBadgeClasses(review.riskLevel)}`}
                >
                  {review.riskLevel}
                </span>
              </div>
              <p className="text-xs text-content-muted mt-1">
                <span className="font-mono tabular-nums">PR #{review.prNumber}</span> • {timeAgo(new Date(review.createdAt))}
              </p>
            </div>
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
