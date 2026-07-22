"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { IconChevronDown, IconCopy, IconGitBranch, IconGitPullRequest } from "@tabler/icons-react";
import { ReadinessBadge } from "@/components/ui/readiness-badge";
import { SendPrButton } from "./send-pr-button";
import { DiffView } from "./diff-view";
import type { Issue } from "./types";
import { SEV_PILL, SEV_LABEL, PanelSection } from "./presentation";

/**
 * Right pane: the issue's concrete detail — agents involved, evidence, the
 * formatted pull request — repo target, the PR title/body, and the review
 * comment(s) as they'll post — plus the send gate. Per the pipeline spec, the
 * repo target and Post PR / Request changes live HERE (Services), not on Agents.
 */
export function IssuePanel({
  issue,
  isReplaying,
  containerId = null,
}: {
  issue: Issue | null;
  isReplaying: boolean;
  /** Real persisted container backing this issue → the send gate is LIVE. Null
   *  (sample/demo data) → the honest disabled shell; the button never fires on
   *  fabricated data. */
  containerId?: string | null;
}) {
  return (
    <>
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Pull request</h2>
        {issue && !isReplaying && (
          <span className={`rounded-full border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide ${SEV_PILL[issue.severity]}`}>{SEV_LABEL[issue.severity]}</span>
        )}
      </header>

      {!issue || isReplaying ? (
        <AnimatePresence mode="wait">
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="shrink-0 border-b border-border-subtle px-3 py-2.5">
              <p className="text-[12.5px] text-content-muted">
                {isReplaying ? "Synthesizing pull request from verified findings..." : "Select an issue to load its pull request — the formatted review Kuma will post, and where you approve sending it."}
              </p>
            </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PanelSection title="Repository">
              <p className="px-1 text-[11px] leading-4 text-content-muted">
                The target repo and <span className="font-mono">base ← branch</span> the PR opens against.
              </p>
            </PanelSection>
            <PanelSection title="Pull request">
              <p className="px-1 text-[11px] leading-4 text-content-muted">
                The formatted PR — title and description — assembled from the verified findings.
              </p>
            </PanelSection>
            <PanelSection title="Review comments">
              <p className="px-1 text-[11px] leading-4 text-content-muted">
                Each verified finding, rendered as the <span className="font-mono">path:line</span> comment it posts to the PR.
              </p>
            </PanelSection>
          </div>
          <footer className="shrink-0 space-y-2 border-t border-border-subtle px-3 py-3">
            <button type="button" disabled className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white opacity-50">
              <IconGitPullRequest size={14} stroke={2} /> Post pull request
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" disabled className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-muted opacity-60">
                Request changes
              </button>
              <button type="button" disabled className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-muted opacity-60">
                <IconCopy size={13} stroke={1.75} /> Copy patch
              </button>
            </div>
            <p className="text-[10px] leading-4 text-content-muted/80">
              Posting opens the PR on your repo — the solution is approved on the Agents page first.
            </p>
          </footer>
          </motion.div>
        </AnimatePresence>
      ) : (
        <motion.div
          key="content"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* The big-picture Synthesizer projection mounts here once a real
              IssueContainer backs the selected issue — it is deliberately NOT
              wired to sample data, so the product surface never shows a
              fabricated review (connector step unifies Issue↔Container). */}

          {/* Repository target */}
          <div className="shrink-0 space-y-1.5 border-b border-border-subtle px-3 py-2.5">
            {/* Repo selector → Connections: the direct path to install/manage
                the Kuma GitHub App, where repos are actually connected. When no
                repo is connected the same link is how you add one. */}
            <Link
              href="/connections"
              title="Manage connected repositories"
              className="flex w-full items-center gap-2 rounded-lg border border-border-default bg-surface-2 px-2.5 py-1.5 text-left text-[11px] text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
            >
              <IconGitBranch size={13} stroke={1.75} className="shrink-0 text-content-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono">acme-corp/{issue.serviceId}</span>
              <IconChevronDown size={12} stroke={2} className="shrink-0 text-content-muted" aria-hidden />
            </Link>
            <p className="font-mono text-[10.5px] text-content-muted">main ← arete/fix-{issue.id}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <PanelSection title="Pull request">
              <div className="px-1">
                <p className="text-[12.5px] font-semibold leading-snug text-content-primary">Fix: {issue.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-content-muted">{issue.summary}</p>
              </div>
            </PanelSection>

            <PanelSection title="Review comment">
              <div className="mx-1 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${SEV_PILL[issue.severity]}`}>{SEV_LABEL[issue.severity]}</span>
                  <span className="font-mono text-[10.5px] text-content-muted">{issue.where}</span>
                </div>
                <DiffView file={issue.fix.file} rows={issue.fix.rows} />
              </div>
            </PanelSection>
          </div>

          <footer className="shrink-0 space-y-2 border-t border-border-subtle px-3 py-3">
            {/* Gate 2 of 2 (the send gate): LIVE only when a real container
                backs this issue — it drives /api/containers/[id]/send and shows
                the true outcome. On sample data it is an honest disabled shell,
                never a no-op that implies it can post. */}
            {containerId ? (
              <SendPrButton containerId={containerId} />
            ) : (
              <button
                type="button"
                disabled
                title="Open a reviewed issue backed by a real container to post its pull request"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white opacity-50"
              >
                <IconGitPullRequest size={14} stroke={2} /> Post pull request
              </button>
            )}
            {/* Both are inert — no handler exists yet. Disabled rather than
                merely unstyled so the UI never implies an action it cannot
                perform. Drop the disabled state when the handlers land. */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled
                title="Requesting changes isn't wired up yet"
                className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-secondary opacity-50"
              >
                Request changes
              </button>
              <button
                type="button"
                disabled
                title="Copying the patch isn't wired up yet"
                className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-secondary opacity-50"
              >
                <IconCopy size={13} stroke={1.75} /> Copy patch
              </button>
            </div>
            <div className="flex justify-center pt-0.5">
              <ReadinessBadge level="soon" />
            </div>
            <p className="text-[10px] leading-4 text-content-muted/80">
              Posting opens the pull request on your repo — the solution is approved on the Agents page first.
            </p>
          </footer>
        </motion.div>
      )}
    </>
  );
}
