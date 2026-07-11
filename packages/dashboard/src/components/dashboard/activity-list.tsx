"use client";

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
        <motion.div
          key={review.id}
          variants={fadeSlideUp}
          className="flex gap-4 p-3 rounded-xl hover:bg-white/[0.02] transition-colors"
        >
          <div className="w-2 h-2 mt-2 rounded-full bg-accent-primary shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
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
        </motion.div>
      ))}
    </motion.div>
  );
}
