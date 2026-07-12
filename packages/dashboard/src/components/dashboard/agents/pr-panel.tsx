"use client";

import { useState, type ReactNode } from "react";
import { IconChevronDown, IconExternalLink } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PrPanelProps {
  hasReviews: boolean;
  /** Most recent reviewed PR (real data from the view model), if any. */
  latestReview?: {
    repoFullName: string;
    prNumber: number;
    riskLevel: string;
  } | null;
  /** Total verified findings posted (real, from commentsByCategory). */
  totalFindings: number;
}

function riskDotClass(riskLevel: string): string {
  switch (riskLevel.toLowerCase()) {
    case "critical":
    case "high":
      return "bg-accent-danger";
    case "medium":
      return "bg-amber-400";
    case "low":
      return "bg-accent-success";
    default:
      return "bg-content-muted";
  }
}

/**
 * Right pane of the /agents workspace, styled like Orca's git panel: a
 * primary "View PR" action, a `repo · PR #n · vs main` comparison line, and
 * collapsible Findings / Files changed / Commits sections.
 *
 * HONESTY: only real view-model data is shown (repo, PR number, risk level,
 * verified finding total). File-level and commit-level detail isn't synced
 * yet, so those sections say so plainly instead of inventing rows.
 */
export function PrPanel({ hasReviews, latestReview, totalFindings }: PrPanelProps) {
  const pr = hasReviews ? latestReview ?? null : null;
  const prUrl = pr ? `https://github.com/${pr.repoFullName}/pull/${pr.prNumber}` : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Pull request panel">
      {/* Pane header with the primary action */}
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
          Pull Request
        </h2>
        {prUrl ? (
          <Button asChild size="sm" className="h-6 rounded-lg px-2.5 text-[11px]">
            <a href={prUrl} target="_blank" rel="noreferrer">
              View PR
              <IconExternalLink size={12} stroke={2} />
            </a>
          </Button>
        ) : (
          <Button
            size="sm"
            disabled
            title="Connect a repository to open reviewed PRs"
            className="h-6 rounded-lg px-2.5 text-[11px]"
          >
            View PR
          </Button>
        )}
      </header>

      {/* Comparison line */}
      <div className="shrink-0 border-b border-border-subtle px-3 py-2">
        {pr ? (
          <p className="truncate font-mono text-[11px] text-content-muted">
            <span className="text-content-secondary">{pr.repoFullName}</span>
            {" · "}
            <span className="tabular-nums">PR #{pr.prNumber}</span>
            {" · "}
            vs main
          </p>
        ) : (
          <p className="font-mono text-[11px] text-content-muted">No pull request yet</p>
        )}
      </div>

      {/* Collapsible sections */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelSection title="Findings" count={pr ? totalFindings : 0}>
          {pr ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-md px-1 py-0.5 font-mono text-[11px]">
                <span
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", riskDotClass(pr.riskLevel))}
                  aria-hidden
                />
                <span className="capitalize text-content-secondary">{pr.riskLevel} risk</span>
                <span className="ml-auto tabular-nums text-content-muted">
                  {totalFindings} verified
                </span>
              </div>
              <p className="px-1 text-[11px] leading-4 text-content-muted">
                Each finding is posted inline on the PR as{" "}
                <span className="font-mono">path:line</span> comments by its specialist.
              </p>
            </div>
          ) : (
            <p className="px-1 text-[11px] leading-4 text-content-muted">
              No findings yet — they appear here once a pull request is reviewed.
            </p>
          )}
        </PanelSection>

        <PanelSection title="Files changed">
          <p className="px-1 text-[11px] leading-4 text-content-muted">
            {pr
              ? "File-level +adds/−dels aren't synced yet — coming with deeper GitHub linking."
              : "No files yet — changed files with +adds/−dels will list here."}
          </p>
        </PanelSection>

        <PanelSection title="Commits">
          <p className="px-1 text-[11px] leading-4 text-content-muted">
            {pr
              ? "Commit history isn't synced yet — coming with deeper GitHub linking."
              : "No commits yet — reviewed commits will list here."}
          </p>
        </PanelSection>
      </div>
    </section>
  );
}

function PanelSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border-b border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-content-muted transition-colors hover:text-content-secondary"
      >
        <IconChevronDown
          size={12}
          stroke={2}
          className={cn("shrink-0 transition-transform duration-150", !open && "-rotate-90")}
          aria-hidden
        />
        {title}
        {typeof count === "number" && (
          <span className="ml-auto font-mono text-[10px] tabular-nums text-content-muted">
            {count}
          </span>
        )}
      </button>
      {open && <div className="px-2 pb-3">{children}</div>}
    </div>
  );
}
