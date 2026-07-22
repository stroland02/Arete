"use client";

import { IconGitPullRequest } from "@tabler/icons-react";
import type { ServiceReviewRow } from "@/lib/queries";
import { riskPill, shortWhen, PanelSection } from "./presentation";

/**
 * Right pane in REAL mode: the selected review's real facts (PR number, risk,
 * verified-finding count) — grounded entirely in the stored review, never
 * fabricated. The one-click Fix→approve→send workflow is honestly teased as
 * coming next (Slice B/C) rather than faked with a sample diff.
 */
export function ReviewPanel({ review }: { review: ServiceReviewRow | null }) {
  return (
    <>
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Pull request</h2>
        {review && (
          <span
            className={`rounded-full border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide ${riskPill(review.riskLevel)}`}
          >
            {review.riskLevel}
          </span>
        )}
      </header>

      {!review ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
          <p className="text-[12.5px] leading-5 text-content-muted">
            Select a pull request on the left to see its review — the verified findings, and where
            you&apos;ll approve posting the fix.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 space-y-1 border-b border-border-subtle px-3 py-2.5">
            <p className="font-mono text-[12.5px] text-content-primary">PR #{review.prNumber}</p>
            <p className="font-mono text-[10.5px] text-content-muted">reviewed {shortWhen(review.createdAt)}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <PanelSection title="Verified findings">
              <p className="px-1 text-[11px] leading-5 text-content-muted">
                <span className="font-mono text-content-secondary">{review.findingCount}</span> verified
                finding{review.findingCount === 1 ? "" : "s"} — each streams into the Synthesizer on the
                left as the <span className="font-mono">path:line</span> comment it posts to the PR.
              </p>
            </PanelSection>
            <PanelSection title="Proposed fix">
              <p className="px-1 text-[11px] leading-5 text-content-muted">
                Next: the PM dispatches specialists to propose the actual patch, you approve it, and Kuma
                stages and opens the pull request — all from here. Today Kuma posts its verified findings
                to your PR for you to act on.
              </p>
            </PanelSection>
          </div>

          <footer className="shrink-0 space-y-2 border-t border-border-subtle px-3 py-3">
            <button
              type="button"
              disabled
              title="The Fix workflow lands in the next release"
              className="inline-flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white opacity-50"
            >
              <IconGitPullRequest size={14} stroke={2} /> Fix &amp; open PR
            </button>
            <p className="text-[10px] leading-4 text-content-muted/80">
              The Fix workflow — PM dispatch → agent solutions → your approval → send — is coming next.
            </p>
          </footer>
        </div>
      )}
    </>
  );
}
