"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { SynthesizerConsole } from "../agents/synthesizer-console";
import { StatusBoardLive } from "./status-board";
import { useInView } from "framer-motion";
import { IconBrandGithub, IconChevronDown, IconPlus } from "@tabler/icons-react";
import type { ServiceReviewGroup, ServiceReviewRow } from "@/lib/queries";
import { TriageBar } from "./triage-bar";
import { deriveTriage, workItemTriageStatus, type TriageStatus } from "./triage";
import type { Issue, Service, Severity } from "./types";
import { SEV_DOT, SEV_PILL, riskDot } from "./presentation";
import { IssueSynthesizerConsole } from "./issue-synthesizer-console";
import { ReviewPanel } from "./review-panel";
import { IssuePanel } from "./issue-panel";
import { WorkItemInboxSection } from "./work-item-inbox";
import { WorkItemPanel } from "./work-item-panel";
import type { InboxView, WorkItemView } from "@/lib/work-items";
import type { PendingApprovalView } from "@/lib/approvals";
import { ApprovalsSection } from "./approvals-section";

/**
 * Services "Triage Inbox" workspace. Production signals from CONNECTED
 * telemetry (Sentry, Vercel, Stripe, CI, PostHog) plus Kuma's own review
 * findings are compiled and deduped PER SERVICE and shown here, each with the
 * telemetry evidence and the specialist agent's proposed code fix; the human
 * approves.
 *
 * Layout mirrors /agents: a 260px rail, a flexible center pane, a 320px right
 * pane. Rail = services, each expandable to its issues, plus a "connect more"
 * list drawn from the real connector catalog. Center = the selected issue's
 * full detail (what happened, proposed fix, activity, actions) — this is the
 * pane that needs the width. Right = a per-issue "team chat": a scripted
 * transcript of the SAME agents/telemetry that appear in the issue's own
 * timeline, narrated as a conversation — never a live/free-floating
 * assistant, same honesty pattern as the Synthesizer console.
 *
 * Data comes in as props (the real Service/Issue contract). The authenticated
 * /services page renders it EMPTY by default — no fabricated services or
 * incidents. The illustrative SAMPLE_* data that drives the marketing preview
 * lives in the marketing layer beside its only consumer
 * (components/marketing/services-preview-fixtures.ts) — deliberately NOT in
 * this file, so fabricated telemetry cannot reach a real account screen.
 */

// Back-compat public surface. The data contract and the work-item panel were
// split into their own modules, but both were imported FROM this path before
// the split (`diff-view.tsx`, `diff-stat.ts` and their tests take `DiffRow`
// from here; the test file takes `WorkItemPanel` from here). Re-exporting keeps
// every one of those import paths resolving, so the split touched no importer.
export type { Severity, DiffRow, Issue, Service } from "./types";
export { WorkItemPanel } from "./work-item-panel";

export interface ServicesWorkspaceProps {
  services?: Service[];
  issues?: Issue[];
  /**
   * "embedded" (default) cancels the dashboard shell's padding and stretches
   * to the viewport height — the /agents pattern. "framed" is a fixed-height
   * variant with no negative margin, for embedding inside a card elsewhere
   * (e.g. the marketing landing page preview).
   */
  variant?: "embedded" | "framed";
  /** Whether a repository is connected — switches empty copy from "connect" to "awaiting". */
  connected?: boolean;
  /**
   * Container to stream in the center Synthesizer (a review id). Deep-linked
   * via /services?container=<reviewId> (e.g. from a review page). Null → the
   * Synthesizer shows its onboarding state.
   */
  containerId?: string | null;
  /**
   * The tenant's connected repositories (full names). Listed in the rail even
   * before any review runs — a connected repo is a populated state (the Git
   * service), never an empty one. Account-State Contract three-state rule.
   */
  repositories?: string[];
  /**
   * The connected repo's REAL reviews, grouped by repository (the authenticated
   * /services inbox). When provided, the rail lists these real PRs and
   * selecting one streams its real Synthesizer transcript in the center; the
   * sample `services`/`issues` above drive the marketing preview ONLY. Its
   * mere presence (even []) switches the workspace into real mode.
   */
  reviewGroups?: ServiceReviewGroup[];
  /**
   * Infrastructure commands a paused agent is waiting on a human to authorize.
   * Empty (the default) renders no section at all — see `ApprovalsSection`:
   * an empty queue header would imply there is something to watch.
   */
  approvals?: PendingApprovalView[];
  /**
   * The work-item inbox (scans + review findings + telemetry errors) for the
   * tenant's connected repos, plus the latest ScanRun for the honest scan
   * status line. Null/undefined hides the section (marketing preview or a
   * disconnected account).
   */
  inbox?: InboxView | null;
}

// No-op store for useHasMounted below: the "store" never changes, we only
// care that useSyncExternalStore re-renders once client and server snapshots
// diverge (i.e. once hydration completes).
function subscribeNever() {
  return () => {};
}

/**
 * True once hydration has completed, false during SSR and the first client
 * render. Implemented with useSyncExternalStore (not a state+effect pair) so
 * the flip to `true` happens without an extra synchronous setState call
 * inside an effect body — see https://react.dev/reference/react/useSyncExternalStore.
 */
function useHasMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * Embedded (full-bleed) triage workspace. When no services are connected,
 * the rail's "Connect your tools" list is still real and actionable — never
 * fabricated rows. The marketing preview passes SAMPLE_* + variant="framed"
 * to show the populated UI inside a card.
 */
export function ServicesWorkspace({ services = [], issues = [], variant = "embedded", connected = false, containerId = null, reviewGroups, repositories = [], inbox = null, approvals = [] }: ServicesWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { margin: "-100px 0px -100px 0px" });

  // Guard against hydration: defer observer logic until after first client render
  const hasMounted = useHasMounted();

  // Real mode: the authenticated /services page passes reviewGroups (even []),
  // switching the rail + center + right panel to real reviews. The marketing
  // preview passes no reviewGroups and keeps the scripted sample path below.
  const realMode = reviewGroups !== undefined;
  // Connected repos with no reviews yet — still listed in the rail as the Git
  // service ("awaiting first PR"), so a connected account never reads as empty.
  const idleRepos = realMode
    ? repositories.filter((r) => !(reviewGroups ?? []).some((g) => g.repositoryFullName === r))
    : [];
  const [activeContainerId, setActiveContainerId] = useState<string | null>(containerId);
  const [openRepo, setOpenRepo] = useState<string | null>(reviewGroups?.[0]?.repositoryFullName ?? null);
  const selectedReview: ServiceReviewRow | null =
    reviewGroups?.flatMap((g) => g.reviews).find((r) => r.id === activeContainerId) ?? null;

  // Work-item inbox selection: selecting an item shows its detail+evidence in
  // the right pane; a fixing/staged item also points the center Kuma console
  // at its container stream.
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const selectedItem: WorkItemView | null =
    inbox?.items.find((i) => i.id === activeItemId) ?? null;
  function handleSelectItem(it: WorkItemView) {
    setActiveItemId((cur) => (cur === it.id ? null : it.id));
    if (it.containerId) setActiveContainerId(it.containerId);
  }

  const [serviceId, setServiceId] = useState<string | null>(services[0]?.id ?? null);
  const [issueId, setIssueId] = useState<string | null>(
    issues.find((i) => i.serviceId === services[0]?.id)?.id ?? null
  );

  const [isReplaying, setIsReplaying] = useState(false);
  const [replayStep, setReplayStep] = useState(0);

  // When scrolled into view, start playing the initially selected issue.
  // Also re-triggers when scrolling away and back (resets first).
  const prevInView = useRef(false);
  useEffect(() => {
    if (!hasMounted || variant !== "framed" || !issueId) return;

    if (isInView && !prevInView.current) {
      // Just entered viewport — kick off the replay
      setReplayStep(0);
      setIsReplaying(true);
    } else if (!isInView && prevInView.current) {
      // Just left viewport — reset so it replays on next scroll
      setIsReplaying(false);
      setReplayStep(0);
    }
    prevInView.current = isInView;
  }, [isInView, hasMounted, issueId, variant]);

  const hasServices = services.length > 0;
  const activeService = serviceId ?? services[0]?.id ?? null;
  const selected = issues.find((i) => i.id === issueId) ?? null;

  function handleSelectIssue(id: string) {
    if (id === issueId) return;
    setIssueId(id);
    setReplayStep(0);
    setIsReplaying(true);
  }

  useEffect(() => {
    if (isReplaying && selected) {
      // replayStep is already 0 here: both places that flip isReplaying to
      // true (handleSelectIssue below, and the scroll-into-view effect above)
      // reset it in the same synchronous batch before this effect runs.
      const totalSteps = selected.timeline.length;
      const timers = selected.timeline.map((_, idx) => 
        setTimeout(() => setReplayStep(idx + 1), (idx + 1) * 700)
      );
      timers.push(setTimeout(() => setIsReplaying(false), (totalSteps * 700) + 400));
      return () => timers.forEach(clearTimeout);
    }
  }, [isReplaying, selected]);

  function toggleService(id: string) {
    setServiceId((current) => (current === id ? null : id));
  }

  // Same column widths as /agents (260px rail / flexible center / 320px
  // right) so the two pages read as one consistent system.
  // Full-bleed (-m-8) lives on the WRAPPER so the triage bar and the 3-pane
  // grid share one bleed column — putting it on the grid alone pulls the grid
  // up underneath the bar (the header-collision bug). The grid then fills the
  // remaining height as a flex child instead of claiming the full viewport.
  const wrapperClass =
    variant === "embedded"
      ? "-m-8 flex min-h-0 flex-col border-t border-border-subtle bg-surface-1/20 lg:h-[calc(100vh-4.5rem)]"
      : "flex min-h-0 flex-col";
  const outerClass =
    variant === "embedded"
      ? "grid min-h-[540px] grid-cols-1 divide-y divide-border-subtle overflow-hidden lg:min-h-0 lg:flex-1 lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:divide-x lg:divide-y-0"
      : "grid min-h-[560px] grid-cols-1 divide-y divide-border-subtle overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:divide-x lg:divide-y-0";

  // Sample Issue.status → TriageStatus (marketing preview only).
  const sampleStatus = (s: string): TriageStatus =>
    s === "Fix proposed" ? "awaiting" : s === "Agent fixing" || s === "Triaging" ? "in_flight" : "clear";
  const triageCounts = realMode
    // Real reviews still carry no lifecycle field → each open review is
    // in-flight. Work items DO carry their container's state now, so awaiting
    // and blocked are real: they are derived by the same rule the panel uses to
    // pick a gate, which is what keeps this bar from reading "Awaiting
    // approval 0" while an Approve button is visible beside it.
    ? deriveTriage([
        ...(reviewGroups ?? []).flatMap((g) => g.reviews).map(() => ({ status: "in_flight" as TriageStatus })),
        ...(inbox?.items ?? []).map((i) => ({ status: workItemTriageStatus(i) })),
        // A paused agent waiting on a command decision is the most literal
        // "awaiting approval" the product has.
        ...approvals.map(() => ({ status: "awaiting" as TriageStatus })),
      ])
    : deriveTriage(issues.map((i) => ({ status: sampleStatus(i.status) })));

  return (
    <div ref={containerRef} className={wrapperClass}>
      <TriageBar counts={triageCounts} />
      <div className={outerClass}>
      {/* Rail: services (each expandable to its issues) + connect catalog */}
      <section className="flex min-h-0 flex-1 flex-col" aria-label="Services">
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Services</h2>
          <span className="font-mono text-[10px] tabular-nums text-content-muted">
            {realMode ? (reviewGroups?.length ?? 0) + idleRepos.length : services.length}
          </span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Real mode: the connected repo's reviews, grouped by repository.
              Selecting a PR sets the active container id, which the center
              Synthesizer streams from /api/containers/[id]/stream. */}
          {/* Connected repos with no reviews yet: the Git service rows. Always
              visible when a repo is connected — awaiting activity, not absent. */}
          {realMode && idleRepos.length > 0 && (
            <ul className="border-b border-border-subtle py-1">
              {idleRepos.map((fullName) => (
                <li key={fullName}>
                  <div className="flex w-full items-center gap-2 py-2.5 pl-3 pr-3">
                    <IconBrandGithub size={13} stroke={1.75} className="shrink-0 text-content-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-content-primary">
                      {fullName}
                    </span>
                    <span className="shrink-0 rounded-full border border-accent-success/25 bg-accent-success/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-success">
                      Connected
                    </span>
                  </div>
                  <p className="pb-2 pl-8 pr-3 text-[11px] leading-4 text-content-muted">
                    Awaiting its first pull request — reviews will appear here.
                  </p>
                </li>
              ))}
            </ul>
          )}
          {realMode &&
            ((reviewGroups?.length ?? 0) > 0 ? (
              <ul className="border-b border-border-subtle py-1">
                {reviewGroups!.map((g) => {
                  const expanded = g.repositoryFullName === openRepo;
                  return (
                    <li key={g.repositoryFullName} className="relative">
                      {expanded && (
                        <span className="absolute inset-y-1 left-0 z-10 w-0.5 rounded-r bg-accent-primary" aria-hidden />
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setOpenRepo((cur) => (cur === g.repositoryFullName ? null : g.repositoryFullName))
                        }
                        aria-expanded={expanded}
                        className={`flex w-full items-center gap-2 py-2.5 pl-3 pr-3 text-left transition-colors ${
                          expanded ? "bg-accent-primary/[0.06]" : "hover:bg-content-primary/[0.04]"
                        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-primary/40`}
                      >
                        <IconChevronDown
                          size={12}
                          stroke={2}
                          className={`shrink-0 text-content-muted transition-transform ${expanded ? "" : "-rotate-90"}`}
                          aria-hidden
                        />
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${riskDot(g.worstRisk)}`} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-content-primary">
                          {g.repositoryFullName}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-content-muted">
                          {g.reviews.length}
                        </span>
                      </button>
                      {expanded && (
                        <ul className="pb-1">
                          {g.reviews.map((r) => {
                            const on = r.id === activeContainerId;
                            return (
                              <li key={r.id}>
                                <button
                                  type="button"
                                  onClick={() => setActiveContainerId(r.id)}
                                  aria-current={on ? "true" : undefined}
                                  className={`flex w-full items-center gap-2 py-1.5 pl-9 pr-3 text-left transition-colors ${
                                    on
                                      ? "bg-accent-primary/[0.1] text-content-primary"
                                      : "text-content-secondary hover:bg-content-primary/[0.04]"
                                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-primary/40`}
                                >
                                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${riskDot(r.riskLevel)}`} />
                                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                                    PR #{r.prNumber}
                                  </span>
                                  <span
                                    className="shrink-0 font-mono text-[10px] tabular-nums text-content-muted"
                                    title={`${r.findingCount} verified finding${r.findingCount === 1 ? "" : "s"}`}
                                  >
                                    {r.findingCount}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : idleRepos.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="text-[12px] text-content-secondary">No reviews yet.</p>
                <p className="mt-1 text-[11px] leading-5 text-content-muted">
                  {connected
                    ? "Open a pull request on your connected repository — its review appears here."
                    : "Connect a repository to start reviewing pull requests."}
                </p>
              </div>
            ) : null)}
          {!realMode && hasServices && (
            <ul className="border-b border-border-subtle py-1">
              {services.map((s) => {
                const expanded = s.id === activeService;
                const svcIssues = issues.filter((i) => i.serviceId === s.id);
                return (
                  <li key={s.id} className="relative">
                    {expanded && (
                      <span className="absolute inset-y-1 left-0 z-10 w-0.5 rounded-r bg-accent-primary" aria-hidden />
                    )}
                    <button
                      type="button"
                      onClick={() => toggleService(s.id)}
                      aria-expanded={expanded}
                      className={`flex w-full items-center gap-2 py-2.5 pl-3 pr-3 text-left transition-colors ${
                        expanded ? "bg-accent-primary/[0.06]" : "hover:bg-content-primary/[0.04]"
                      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-primary/40`}
                    >
                      <IconChevronDown
                        size={12}
                        stroke={2}
                        className={`shrink-0 text-content-muted transition-transform ${expanded ? "" : "-rotate-90"}`}
                        aria-hidden
                      />
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEV_DOT[s.worst]}`} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-content-primary">{s.id}</span>
                      {s.open > 0 ? (
                        <span className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold ${SEV_PILL[s.worst as Severity]}`}>{s.open}</span>
                      ) : (
                        <span className="shrink-0 font-mono text-[10px] text-content-muted">clear</span>
                      )}
                    </button>
                    {expanded && (
                      <ul className="pb-1">
                        {svcIssues.length === 0 ? (
                          <li className="px-3 py-2 pl-9 text-[11px] text-content-muted">All clear — no open issues.</li>
                        ) : (
                          svcIssues.map((iss) => {
                            const on = iss.id === selected?.id;
                            return (
                              <li key={iss.id}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectIssue(iss.id)}
                                  aria-current={on ? "true" : undefined}
                                  className={`flex w-full items-center gap-2 py-1.5 pl-9 pr-3 text-left transition-colors ${
                                    on ? "bg-accent-primary/[0.1] text-content-primary" : "text-content-secondary hover:bg-content-primary/[0.04]"
                                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-primary/40`}
                                >
                                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEV_DOT[iss.severity]}`} />
                                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{iss.title}</span>
                                </button>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Work-item inbox: what Kuma discovered in the connected repos —
              scans, review findings, telemetry errors. Under the repo rows,
              like unread counts on a mailbox. */}
          {realMode && inbox && (
            <WorkItemInboxSection
              inbox={inbox}
              activeItemId={activeItemId}
              onSelect={handleSelectItem}
            />
          )}

          {/* A paused agent blocks on this, so it sits above the connect
              affordance: it is the most urgent thing the rail can hold.
              Renders nothing when the queue is empty. */}
          {realMode && <ApprovalsSection approvals={approvals} />}

          <div className="px-3 py-3">
            <Link
              href="/connections"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-2 text-[12px] font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
            >
              <IconPlus size={14} stroke={2} aria-hidden />
              {realMode
                ? connected
                  ? "Add connections"
                  : "Connect a repository"
                : hasServices
                  ? "Connect more services"
                  : connected
                    ? "Connect a telemetry source"
                    : "Connect your services"}
            </Link>
          </div>
        </div>
      </section>

      {/* Center: the Synthesizer — its canonical home. The authenticated
          (embedded) surface hosts the real streaming console (onboarding now,
          live once an Issue↔Container backs the selected issue). The framed
          marketing preview keeps the scripted per-issue replay (clearly
          illustrative sample data). */}
      <section className="flex min-h-0 flex-1 flex-col" aria-label="Synthesizer">
        {variant === "embedded" ? (
          // Streams the selected review (container id = review id) via the
          // existing /api/containers/[id]/stream SSE; null → onboarding state.
          // Real mode drives it from the rail selection; otherwise the
          // deep-linked ?container= id. The situational-awareness board
          // (tiered comms §4) rides the same stream above the console; it
          // renders nothing until specialists report.
          <>
            <StatusBoardLive containerId={realMode ? activeContainerId : containerId} />
            <SynthesizerConsole containerId={realMode ? activeContainerId : containerId} connected={connected} />
          </>
        ) : (
          <IssueSynthesizerConsole issue={selected} isReplaying={isReplaying} replayStep={replayStep} />
        )}
      </section>

      {/* Right: the selected item's detail — a selected work item wins, then
          real review facts in real mode, then the scripted sample issue in the
          marketing preview. */}
      <section className="flex min-h-0 flex-1 flex-col" aria-label="Issue panel">
        {realMode ? (
          selectedItem ? (
            <WorkItemPanel item={selectedItem} />
          ) : (
            <ReviewPanel review={selectedReview} />
          )
        ) : (
          <IssuePanel issue={selected} isReplaying={isReplaying} containerId={realMode ? activeContainerId : null} />
        )}
      </section>
      </div>
    </div>
  );
}
