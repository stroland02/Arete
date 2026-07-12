"use client";

import { IconGitMerge, IconGitPullRequest, IconShieldCheck } from "@tabler/icons-react";

export interface PrOutcomePanelProps {
  hasReviews: boolean;
}

const STEPS = [
  {
    icon: IconShieldCheck,
    title: "Verified findings",
    detail: "Only findings the Synthesizer can prove against your diff move forward.",
    accent: "text-accent-info border-accent-info/25 bg-accent-info/10",
  },
  {
    icon: IconGitPullRequest,
    title: "Posted as PR review comments",
    detail: "Comments land directly on your GitHub pull request — no separate inbox.",
    accent: "text-accent-primary border-accent-primary/25 bg-accent-primary/10",
  },
  {
    icon: IconGitMerge,
    title: "Your merge decision",
    detail: "You review and merge on your own platform, on your own terms. Areté never merges for you.",
    accent: "text-accent-success border-accent-success/25 bg-accent-success/10",
  },
] as const;

/**
 * The PR/merge phase, stated honestly: verified findings → posted as review
 * comments → your call. Static steps, no fake CI graph or live pipeline.
 */
export function PrOutcomePanel({ hasReviews }: PrOutcomePanelProps) {
  return (
    <div className={`glass-panel flex h-full flex-col p-4 ${hasReviews ? "" : "opacity-70"}`}>
      <div className="pb-3">
        <h3 className="text-sm font-semibold text-content-primary">Pull request outcome</h3>
        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-content-muted">
          Where findings land
        </p>
      </div>

      <ol className="relative flex flex-1 flex-col justify-between gap-4">
        {/* Connecting rail */}
        <span
          className="absolute bottom-5 left-[17px] top-5 w-px bg-border-default"
          aria-hidden
        />
        {STEPS.map(({ icon: Icon, title, detail, accent }) => (
          <li key={title} className="relative flex items-start gap-3">
            <span
              className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                hasReviews ? accent : "border-border-default bg-white/5 text-content-muted"
              }`}
            >
              <Icon size={17} stroke={1.75} />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[13px] font-medium text-content-primary">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex items-center gap-2 border-t border-border-subtle pt-3">
        <span
          className={
            hasReviews
              ? "h-1.5 w-1.5 rounded-full bg-accent-success shadow-[0_0_8px_rgba(52,211,153,0.7)]"
              : "h-1.5 w-1.5 rounded-full border border-content-muted/60"
          }
          aria-hidden
        />
        <span className="text-xs font-medium text-content-muted">
          {hasReviews
            ? "Verified findings are posting to your pull requests"
            : "Waiting for your first review"}
        </span>
      </div>
    </div>
  );
}
