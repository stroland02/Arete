"use client";

import { useState, type ReactNode } from "react";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
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
  /** Total verified findings composed (real, from commentsByCategory). */
  totalFindings: number;
}

function riskDotClass(riskLevel: string): string {
  switch (riskLevel.toLowerCase()) {
    case "critical":
    case "high":
      return "bg-accent-danger";
    case "medium":
      return "bg-accent-warning";
    case "low":
      return "bg-accent-success";
    default:
      return "bg-content-muted";
  }
}

/**
 * Right pane of the /agents workspace — the SOLUTION being composed in code.
 *
 * Per the issue-container pipeline spec §2, the Agents panel shows the PR as
 * it is assembled (verified findings → review comments, per-agent provenance,
 * files touched) and carries the FIRST of two human gates: "Approve solution".
 * It deliberately does NOT hold the repository target, and it does NOT post —
 * the repo selector + "Post pull request / Request changes" live on the
 * Services PR panel (the send gate). See §1, §4.7–8 and the two-panel table.
 *
 * HONESTY: only real view-model data is shown (risk level, verified total);
 * file/commit detail isn't synced yet, so those sections say so plainly; the
 * Approve control is a disabled shell until the backend gate is wired.
 */
export function PrPanel({ hasReviews, latestReview, totalFindings }: PrPanelProps) {
  const pr = hasReviews ? latestReview ?? null : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Solution panel">
      {/* Pane header — identifies which PR's solution this is; no repo target
          (that lives on the Services panel). */}
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
          Solution
        </h2>
        {pr && (
          <span className="font-mono text-[10px] tabular-nums text-content-muted">PR #{pr.prNumber}</span>
        )}
      </header>

      {/* Collapsible sections — the composed review */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelSection title="Review comments" count={pr ? totalFindings : 0}>
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
                Each verified finding is composed into a{" "}
                <span className="font-mono">path:line</span> review comment by the specialist that
                raised it.
              </p>
            </div>
          ) : (
            <p className="px-1 text-[11px] leading-4 text-content-muted">
              No comments yet — verified findings are composed here once a pull request is reviewed.
            </p>
          )}
        </PanelSection>

        <PanelSection title="Files touched">
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

      {/* Gate 1 of 2: approve the SOLUTION here; the PR is posted from the
          issue's Services view (the send gate). Disabled shell for now. */}
      <footer className="shrink-0 space-y-2 border-t border-border-subtle px-3 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-content-muted">
          Human verification · 1 of 2
        </p>
        <Button
          size="sm"
          disabled
          title="Connect a repository to enable"
          className="h-8 w-full rounded-lg text-[12px]"
        >
          <IconCheck size={13} stroke={2} aria-hidden />
          Approve solution
        </Button>
        <p className="text-[10px] leading-4 text-content-muted/80">
          Approving readies the fix — you post the pull request from the issue&apos;s Services view.
          Areté never changes your code without approval.
        </p>
      </footer>
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
