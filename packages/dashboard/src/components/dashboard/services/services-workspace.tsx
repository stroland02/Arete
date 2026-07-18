"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { SynthesizerConsole } from "../agents/synthesizer-console";
import { StatusBoardLive } from "./status-board";
import { SendPrButton } from "./send-pr-button";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { IconArrowRight, IconBrandGithub, IconChevronDown, IconCopy, IconGitBranch, IconGitPullRequest, IconHourglassHigh, IconPlus, IconLoader2, IconCheck } from "@tabler/icons-react";
import { KumaLogo } from "@/components/ui/kuma-logo";
import type { ServiceReviewGroup, ServiceReviewRow } from "@/lib/queries";
import { TriageBar } from "./triage-bar";
import { deriveTriage, type TriageStatus } from "./triage";
import { DiffView } from "./diff-view";
import type { InboxView, WorkItemView } from "@/lib/work-items";

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
 * incidents. The SAMPLE_* exports below drive the illustrative marketing
 * preview only.
 */

export type Severity = "critical" | "high" | "medium";

export interface DiffRow {
  kind: "context" | "add" | "remove";
  text: string;
}

export interface Issue {
  id: string;
  serviceId: string;
  source: string; // Sentry | Stripe | CI | Vercel | PostHog | Kuma
  severity: Severity;
  status: string;
  agent: string;
  title: string;
  occurrences: string;
  lastSeen: string;
  where: string; // file:line
  summary: string;
  evidence: { file: string; rows: Array<[string, string]> };
  fix: { file: string; rows: DiffRow[] };
  timeline: Array<{ tone: Severity | "good" | "accent"; text: string; when: string }>;
}

export interface Service {
  id: string;
  open: number;
  worst: Severity | "clear";
}

// ── Illustrative SAMPLE data — marketing preview ONLY, never the real page ──
export const SAMPLE_SERVICES: Service[] = [
  { id: "payments-api", open: 3, worst: "critical" },
  { id: "auth-gateway", open: 2, worst: "high" },
  { id: "orders-service", open: 2, worst: "high" },
  { id: "notifications", open: 1, worst: "medium" },
  { id: "web-dashboard", open: 0, worst: "clear" },
];

export const SAMPLE_ISSUES: Issue[] = [
  {
    id: "p1", serviceId: "payments-api", source: "Sentry", severity: "critical",
    status: "Agent fixing", agent: "Business Logic",
    title: "TypeError: Cannot read 'balance' of null",
    occurrences: "1,204 events", lastSeen: "2m ago", where: "src/billing/charge.ts:23",
    summary: "Free-tier users have a null balance; the charge path assumes a number and throws before the request completes.",
    evidence: { file: "Sentry · TypeError · last 24h", rows: [["user.tier", "'free'"], ["balance", "None ← null"], ["at charge()", "src/billing/charge.ts:23"]] },
    fix: { file: "src/billing/charge.ts", rows: [
      { kind: "context", text: "function charge(order, user) {" },
      { kind: "remove", text: "  const amount = order.total * user.balance" },
      { kind: "add", text: "  const bal = user.balance ?? 0" },
      { kind: "add", text: "  const amount = order.total * bal" },
      { kind: "context", text: "  return stripe.charges.create({ amount })" },
      { kind: "context", text: "}" },
    ] },
    timeline: [
      { tone: "critical", text: "Error detected", when: "Sentry · 2m ago" },
      { tone: "accent", text: "Business Logic agent picked it up", when: "1m ago" },
      { tone: "accent", text: "Cross-checked with the diff & telemetry", when: "40s ago" },
      { tone: "good", text: "Fix proposed — awaiting your approval", when: "just now" },
    ],
  },
  {
    id: "p2", serviceId: "payments-api", source: "Stripe", severity: "high",
    status: "Fix proposed", agent: "Business Logic",
    title: "Charge retried without an idempotency key",
    occurrences: "47 events", lastSeen: "18m ago", where: "src/billing/charge.ts:31",
    summary: "This path already retries on timeout; without an idempotency key a retry can double-charge the customer.",
    evidence: { file: "Stripe · duplicate_charge · 7d", rows: [["event", "charge.retried"], ["idempotency_key", "null ← missing"], ["impact", "2 customers double-charged"]] },
    fix: { file: "src/billing/charge.ts", rows: [
      { kind: "context", text: "await stripe.charges.create(" },
      { kind: "context", text: "  { amount, currency: 'usd' }," },
      { kind: "remove", text: ")" },
      { kind: "add", text: "  { idempotencyKey: order.id }," },
      { kind: "add", text: ")" },
    ] },
    timeline: [
      { tone: "high", text: "Duplicate charges detected", when: "Stripe · 18m ago" },
      { tone: "accent", text: "Business Logic agent analyzing", when: "15m ago" },
      { tone: "good", text: "Fix proposed", when: "12m ago" },
    ],
  },
  {
    id: "p3", serviceId: "payments-api", source: "CI", severity: "medium",
    status: "Triaging", agent: "Test Coverage",
    title: "Flaky test: refund rounding",
    occurrences: "6 of 20 runs", lastSeen: "1h ago", where: "src/orders/refund.test.ts:15",
    summary: "The partial-refund test fails intermittently on rounding — the assertion compares floats directly.",
    evidence: { file: "GitHub Actions · test · 20 runs", rows: [["expected", "4.50"], ["received", "4.499999999"], ["flake_rate", "30%"]] },
    fix: { file: "src/orders/refund.test.ts", rows: [
      { kind: "remove", text: "expect(r.amount).toBe(4.5)" },
      { kind: "add", text: "expect(r.amount).toBeCloseTo(4.5, 2)" },
    ] },
    timeline: [
      { tone: "medium", text: "Flaky test flagged", when: "CI · 1h ago" },
      { tone: "accent", text: "Test Coverage agent triaging", when: "55m ago" },
    ],
  },
  {
    id: "a1", serviceId: "auth-gateway", source: "Kuma", severity: "high",
    status: "Fix proposed", agent: "Security",
    title: "Refresh token written to localStorage",
    occurrences: "312 events", lastSeen: "22m ago", where: "src/auth/session.ts:42",
    summary: "Tokens in localStorage are exposed to any script — an XSS bug would leak long-lived sessions.",
    evidence: { file: "Kuma review · Security · PR #418", rows: [["storage", "localStorage"], ["token_ttl", "30 days"], ["risk", "XSS → session theft"]] },
    fix: { file: "src/auth/session.ts", rows: [
      { kind: "remove", text: "localStorage.setItem('refresh', token)" },
      { kind: "add", text: "cookies().set('refresh', token, {" },
      { kind: "add", text: "  httpOnly: true, secure: true })" },
    ] },
    timeline: [
      { tone: "high", text: "Flagged on PR #418", when: "Kuma · 22m ago" },
      { tone: "accent", text: "Security agent analyzing", when: "20m ago" },
      { tone: "good", text: "Fix proposed", when: "16m ago" },
    ],
  },
  {
    id: "a2", serviceId: "auth-gateway", source: "Vercel", severity: "medium",
    status: "Triaging", agent: "Deployment Safety",
    title: "AUTH_SECRET missing in preview builds",
    occurrences: "preview builds", lastSeen: "40m ago", where: "vercel.json",
    summary: "Preview deployments boot without AUTH_SECRET, so login silently 500s on every PR preview.",
    evidence: { file: "Vercel · deploy · preview", rows: [["AUTH_SECRET", "undefined"], ["env", "preview"], ["result", "login 500"]] },
    fix: { file: "vercel.json", rows: [
      { kind: "context", text: '"env": {' },
      { kind: "add", text: '  "AUTH_SECRET": "@auth_secret"' },
      { kind: "context", text: "}" },
    ] },
    timeline: [
      { tone: "medium", text: "Preview boot failure", when: "Vercel · 40m ago" },
      { tone: "accent", text: "Deployment Safety triaging", when: "38m ago" },
    ],
  },
  {
    id: "o1", serviceId: "orders-service", source: "Sentry", severity: "high",
    status: "Agent fixing", agent: "Performance",
    title: "N+1 query on the orders list",
    occurrences: "8,900 events", lastSeen: "5m ago", where: "src/orders/list.ts:88",
    summary: "Each order row fires its own query; a 500-order page issues 500 round-trips and times out under load.",
    evidence: { file: "Sentry · slow_query · p95", rows: [["queries_per_req", "512"], ["p95_latency", "4.2s"], ["budget", "800ms"]] },
    fix: { file: "src/orders/list.ts", rows: [
      { kind: "remove", text: "for (const id of ids)" },
      { kind: "remove", text: "  orders.push(await find(id))" },
      { kind: "add", text: "const orders = await db.order.findMany({" },
      { kind: "add", text: "  where: { id: { in: ids } } })" },
    ] },
    timeline: [
      { tone: "high", text: "Latency regression", when: "Sentry · 5m ago" },
      { tone: "accent", text: "Performance agent picked it up", when: "4m ago" },
      { tone: "accent", text: "Building the fix", when: "1m ago" },
    ],
  },
  {
    id: "o2", serviceId: "orders-service", source: "CI", severity: "medium",
    status: "Triaging", agent: "Quality",
    title: "Dead code after checkout refactor",
    occurrences: "lint", lastSeen: "2h ago", where: "src/orders/legacy.ts",
    summary: "A whole module is unreferenced after the checkout refactor.",
    evidence: { file: "CI · knip", rows: [["unused_exports", "7"], ["file", "legacy.ts"]] },
    fix: { file: "src/orders/legacy.ts", rows: [{ kind: "remove", text: "// entire file unused — safe to delete" }] },
    timeline: [{ tone: "medium", text: "Dead code flagged", when: "CI · 2h ago" }],
  },
  {
    id: "n1", serviceId: "notifications", source: "PostHog", severity: "medium",
    status: "Triaging", agent: "Business Logic",
    title: "Signup → verify funnel dropped 18%",
    occurrences: "trend", lastSeen: "3h ago", where: "src/notify/email.ts",
    summary: "Verification emails started bouncing after the template change; PostHog shows the funnel drop.",
    evidence: { file: "PostHog · funnel · 24h", rows: [["step", "verify_email"], ["drop", "-18%"], ["suspect", "template v3"]] },
    fix: { file: "src/notify/email.ts", rows: [
      { kind: "remove", text: "from: 'no-reply@localhost'" },
      { kind: "add", text: "from: process.env.MAIL_FROM" },
    ] },
    timeline: [{ tone: "medium", text: "Funnel anomaly", when: "PostHog · 3h ago" }],
  },
];

// ── Style maps (semantic tokens — adapt to both themes) ──────────────────────
const SEV_DOT: Record<Severity | "clear", string> = {
  critical: "bg-accent-danger", high: "bg-accent-warning", medium: "bg-accent-info", clear: "bg-accent-success",
};
const SEV_PILL: Record<Severity, string> = {
  critical: "text-accent-danger border-accent-danger/30 bg-accent-danger/10",
  high: "text-accent-warning border-accent-warning/30 bg-accent-warning/10",
  medium: "text-accent-info border-accent-info/30 bg-accent-info/10",
};
const SEV_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium" };
const TONE_TEXT: Record<string, string> = {
  critical: "text-accent-danger", high: "text-accent-warning", medium: "text-accent-info",
  good: "text-accent-success", accent: "text-accent-primary",
};

function markerForTone(tone: Issue["timeline"][number]["tone"]): string {
  if (tone === "good") return "✓";
  if (tone === "accent") return "◈";
  return "●"; // critical/high/medium — the telemetry source's own detection
}

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
   * The work-item inbox (scans + review findings + telemetry errors) for the
   * tenant's connected repos, plus the latest ScanRun for the honest scan
   * status line. Null/undefined hides the section (marketing preview or a
   * disconnected account).
   */
  inbox?: InboxView | null;
}

// Real review riskLevel → rail dot / pill styling (risk tiers, not the sample
// Severity union). "low"/"unknown" collapse to the calm/success tone.
const RISK_DOT: Record<string, string> = {
  critical: "bg-accent-danger",
  high: "bg-accent-warning",
  medium: "bg-accent-info",
};
function riskDot(risk: string): string {
  return RISK_DOT[risk.toLowerCase()] ?? "bg-accent-success";
}
const RISK_PILL: Record<string, string> = {
  critical: "text-accent-danger border-accent-danger/30 bg-accent-danger/10",
  high: "text-accent-warning border-accent-warning/30 bg-accent-warning/10",
  medium: "text-accent-info border-accent-info/30 bg-accent-info/10",
};
function riskPill(risk: string): string {
  return RISK_PILL[risk.toLowerCase()] ?? "text-accent-success border-accent-success/30 bg-accent-success/10";
}
function shortWhen(iso: string): string {
  // Date-only, locale-formatted; the transcript carries the precise moment.
  return new Date(iso).toLocaleDateString();
}

/**
 * Embedded (full-bleed) triage workspace. When no services are connected,
 * the rail's "Connect your tools" list is still real and actionable — never
 * fabricated rows. The marketing preview passes SAMPLE_* + variant="framed"
 * to show the populated UI inside a card.
 */
export function ServicesWorkspace({ services = [], issues = [], variant = "embedded", connected = false, containerId = null, reviewGroups, repositories = [], inbox = null }: ServicesWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { margin: "-100px 0px -100px 0px" });

  // Guard against hydration: defer observer logic until after first client render
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => { setHasMounted(true); }, []);

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
      setReplayStep(0);
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
  const outerClass =
    variant === "embedded"
      ? "-m-8 grid min-h-[540px] grid-cols-1 divide-y divide-border-subtle border-t border-border-subtle bg-surface-1/20 overflow-hidden lg:grid lg:h-[calc(100vh-4.5rem)] lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:divide-x lg:divide-y-0"
      : "grid min-h-[560px] grid-cols-1 divide-y divide-border-subtle overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:divide-x lg:divide-y-0";

  // Sample Issue.status → TriageStatus (marketing preview only).
  const sampleStatus = (s: string): TriageStatus =>
    s === "Fix proposed" ? "awaiting" : s === "Agent fixing" || s === "Triaging" ? "in_flight" : "clear";
  const triageCounts = realMode
    // Real reviews carry no lifecycle field yet → each open review is in-flight;
    // awaiting/blocked stay 0 until container state reaches this surface.
    ? deriveTriage((reviewGroups ?? []).flatMap((g) => g.reviews).map(() => ({ status: "in_flight" as TriageStatus })))
    : deriveTriage(issues.map((i) => ({ status: sampleStatus(i.status) })));

  return (
    <div ref={containerRef} className="flex min-h-0 flex-col">
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

/**
 * Center pane: the Synthesizer's verification narrative for the selected
 * issue. Structurally identical to the /agents Synthesizer console (header +
 * scripted transcript + pinned, disabled chat input) — reusing the same
 * shape is deliberate: it's the same Synthesizer, just focused on one issue
 * instead of the whole account, so the verification record for a given
 * issue/PR reads the same on both pages.
 */
function IssueSynthesizerConsole({ issue, isReplaying, replayStep }: { issue: Issue | null; isReplaying: boolean; replayStep: number }) {
  return (
    <>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span className={`h-1.5 w-1.5 rounded-full ${issue ? "bg-accent-success" : "bg-content-muted/40"}`} aria-hidden />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Synthesizer</h2>
        <span className="rounded-full border border-accent-info/25 bg-accent-info/10 px-1.5 py-px text-[10px] font-medium text-accent-info">Preview</span>
        {issue && <span className="ml-auto truncate text-[11px] text-content-muted">focused on {issue.title}</span>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {issue ? (
          <ol className="space-y-0.5 font-mono text-xs">
            <li className="pb-2 text-[10px] uppercase tracking-wider text-content-muted">
              Scripted replay of this issue&apos;s verification — not a live model
            </li>
            {issue.timeline.map((t, idx) => {
              const status = isReplaying ? (replayStep > idx ? 'done' : replayStep === idx ? 'running' : 'waiting') : 'done';
              if (status === 'waiting') return null;

              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-md px-2 py-1.5 hover:bg-content-primary/[0.03]"
                >
                  <div className="flex items-start gap-2.5">
                    {status === 'running' ? (
                      <motion.div 
                        className="shrink-0 leading-4 text-accent-primary flex items-center justify-center"
                        animate={{ 
                          filter: ["drop-shadow(0 0 2px rgba(0,212,255,0.2))", "drop-shadow(0 0 8px rgba(0,212,255,0.8))", "drop-shadow(0 0 2px rgba(0,212,255,0.2))"]
                        }}
                        transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                      >
                        <KumaLogo size={13} />
                      </motion.div>
                    ) : (
                      <span className={`shrink-0 leading-4 ${TONE_TEXT[t.tone]}`} aria-hidden>{markerForTone(t.tone)}</span>
                    )}
                    <div className="min-w-0">
                      <p className={`text-content-secondary ${status === 'running' ? 'font-medium' : ''}`}>{t.text}</p>
                      <p className="mt-0.5 text-[11px] leading-4 text-content-muted">{t.when}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </ol>
        ) : (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
            <div className="rounded-2xl border border-border-default bg-content-primary/5 p-3 text-accent-primary">
              <IconHourglassHigh size={24} stroke={1.5} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-content-primary">The Synthesizer verifies every issue</p>
              <p className="text-xs leading-5 text-content-muted">
                Pick a service and an issue on the left to see how the Synthesizer verified it — the
                same verification record whether you look at it here or on the Agents page.
              </p>
            </div>

            {/* Same connect CTA as the Agents page, so a fresh account has a
                clear first step from the center pane, not just the rail. */}
            <Link
              href="/connections"
              className="inline-flex items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/30"
            >
              Connect a repository
              <IconArrowRight size={15} stroke={2} />
            </Link>
          </div>
        )}
      </div>

      {/* Pinned input strip — deliberately disabled: no live model yet, same
          honesty pattern as the /agents Synthesizer console. */}
      <footer className="shrink-0 border-t border-border-subtle px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-2/60 px-3 py-2">
          <span className="font-mono text-xs text-content-muted" aria-hidden>&gt;</span>
          <input
            type="text"
            disabled
            placeholder="Ask the Synthesizer…"
            aria-label="Ask the Synthesizer (live chat coming soon)"
            title="Live chat coming soon"
            className="w-full cursor-not-allowed bg-transparent font-mono text-xs text-content-primary placeholder:text-content-muted/70 focus:outline-none"
          />
        </div>
        <p className="mt-1.5 px-1 font-mono text-[10px] text-content-muted/80">
          preview shell · live chat coming soon{issue ? ` · focused on ${issue.serviceId}` : ""}
        </p>
      </footer>
    </>
  );
}

/**
 * Right pane in REAL mode: the selected review's real facts (PR number, risk,
 * verified-finding count) — grounded entirely in the stored review, never
 * fabricated. The one-click Fix→approve→send workflow is honestly teased as
 * coming next (Slice B/C) rather than faked with a sample diff.
 */
function ReviewPanel({ review }: { review: ServiceReviewRow | null }) {
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

/**
 * Right pane: the issue's concrete detail — agents involved, evidence, the
 * formatted pull request — repo target, the PR title/body, and the review
 * comment(s) as they'll post — plus the send gate. Per the pipeline spec, the
 * repo target and Post PR / Request changes live HERE (Services), not on Agents.
 */
function IssuePanel({
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
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-secondary transition-colors hover:bg-content-primary/5">
                Request changes
              </button>
              <button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-secondary transition-colors hover:bg-content-primary/5">
                <IconCopy size={13} stroke={1.75} /> Copy patch
              </button>
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

// ── Work-item inbox (rail) ───────────────────────────────────────────────────

const KIND_LABEL: Record<WorkItemView["kind"], string> = {
  issue: "Issue",
  opportunity: "Opportunity",
  error: "Error",
  pr_finding: "PR finding",
};
const KIND_CHIP: Record<WorkItemView["kind"], string> = {
  issue: "text-accent-danger border-accent-danger/30 bg-accent-danger/10",
  error: "text-accent-danger border-accent-danger/30 bg-accent-danger/10",
  opportunity: "text-accent-success border-accent-success/30 bg-accent-success/10",
  pr_finding: "text-accent-info border-accent-info/30 bg-accent-info/10",
};

/** The honest scan-status line: real ScanRun status only, never invented. */
function scanStatusLine(lastScan: InboxView["lastScan"]): string {
  if (!lastScan) return "Not scanned yet.";
  if (lastScan.status === "running") return "Scanning…";
  if (lastScan.status === "failed") return `Scan failed: ${lastScan.error ?? "unknown error"} — retry`;
  const when = lastScan.finishedAt ? new Date(lastScan.finishedAt).toLocaleDateString() : "";
  if (lastScan.status === "no_findings") return `Scanned ${when} — no issues found. Rescan anytime.`;
  return `Scanned ${when}.`;
}

function WorkItemInboxSection({
  inbox,
  activeItemId,
  onSelect,
}: {
  inbox: InboxView;
  activeItemId: string | null;
  onSelect: (item: WorkItemView) => void;
}) {
  const [scanRequested, setScanRequested] = useState(false);
  const openIssues = inbox.items.filter((i) => i.state === "open" && i.kind !== "opportunity").length;
  const openOpportunities = inbox.items.filter((i) => i.state === "open" && i.kind === "opportunity").length;
  const scanning = scanRequested || inbox.lastScan?.status === "running";

  async function handleScan() {
    setScanRequested(true);
    try {
      // 202 started / 409 already running — both mean a run is (now) live, so
      // refresh shortly to pick up its ScanRun row. Anything else resets.
      const res = await fetch("/api/scan", { method: "POST" });
      if (res.status === 202 || res.status === 409) {
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setScanRequested(false);
      }
    } catch {
      setScanRequested(false);
    }
  }

  return (
    <div className="border-b border-border-subtle">
      <header className="flex items-center gap-2 px-3 pb-1 pt-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">Work items</h3>
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] tabular-nums text-content-muted">
          <span>Issues ({openIssues})</span>
          <span aria-hidden>/</span>
          <span>Opportunities ({openOpportunities})</span>
        </span>
      </header>

      {inbox.items.length > 0 && (
        <ul className="py-1">
          {inbox.items.map((it) => {
            const on = it.id === activeItemId;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onSelect(it)}
                  aria-current={on ? "true" : undefined}
                  className={`flex w-full items-center gap-2 py-1.5 pl-3 pr-3 text-left transition-colors ${
                    on
                      ? "bg-accent-primary/[0.1] text-content-primary"
                      : "text-content-secondary hover:bg-content-primary/[0.04]"
                  }`}
                >
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold ${KIND_CHIP[it.kind]}`}
                  >
                    {KIND_LABEL[it.kind]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{it.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-content-muted">{it.dimension}</span>
                  <span
                    className="shrink-0 font-mono text-[10px] tabular-nums text-content-muted"
                    title="Verified confidence from the scanning agents"
                  >
                    {Math.round(it.confidence * 100)}%
                  </span>
                  {it.state !== "open" && (
                    <span className="shrink-0 rounded-full border border-border-default bg-surface-2 px-1.5 py-px font-mono text-[9px] text-content-muted">
                      {it.state}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Honest status line + manual re-scan. A scanned-clean repo is
          connected_idle: populated ("no issues found"), never blank. */}
      <div className="flex items-center gap-2 px-3 pb-3 pt-1">
        <p className="min-w-0 flex-1 text-[10.5px] leading-4 text-content-muted">
          {scanRequested ? "Scanning…" : scanStatusLine(inbox.lastScan)}
        </p>
        <button
          type="button"
          onClick={handleScan}
          disabled={scanning}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-default bg-surface-2 px-2 py-1 text-[10.5px] font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {scanning ? (
            <IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden />
          ) : null}
          Scan
        </button>
      </div>
    </div>
  );
}

/**
 * Right pane for a selected work item: the discovered problem/opportunity with
 * its REAL file:line evidence — exactly what the agents cited, nothing else.
 * Triage v1 is exactly two actions (spec ruling): Fix it (issues/errors) or
 * Implement it (opportunities) → the pipeline; Dismiss → dismissed. Only a
 * human triggers either — nothing here auto-starts or auto-sends.
 * Exported for the state-matrix tests.
 */
export function WorkItemPanel({ item }: { item: WorkItemView }) {
  const [busy, setBusy] = useState<null | 'fix' | 'dismiss'>(null);

  async function act(action: 'fix' | 'dismiss') {
    setBusy(action);
    try {
      const res = await fetch(`/api/work-items/${item.id}/${action}`, { method: 'POST' });
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      // fall through to reset
    }
    setBusy(null);
  }

  return (
    <>
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Work item</h2>
        <span className={`rounded-full border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide ${KIND_CHIP[item.kind]}`}>
          {KIND_LABEL[item.kind]}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-1 border-b border-border-subtle px-3 py-2.5">
          <p className="text-[12.5px] font-semibold leading-snug text-content-primary">{item.title}</p>
          <p className="font-mono text-[10.5px] text-content-muted">
            {item.dimension} · {Math.round(item.confidence * 100)}% confidence · {item.state}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <PanelSection title="What Kuma found">
            <p className="whitespace-pre-wrap px-1 text-[11.5px] leading-5 text-content-secondary">{item.detail}</p>
          </PanelSection>
          <PanelSection title="Evidence">
            <ul className="mx-1 space-y-1.5">
              {item.evidence.map((ev, idx) => (
                <li key={idx} className="overflow-hidden rounded-lg border border-border-default bg-surface-2">
                  <div className="border-b border-border-subtle px-2.5 py-1.5 font-mono text-[10.5px] text-content-muted">
                    {ev.path}:{ev.line}
                  </div>
                  {ev.excerpt ? (
                    <pre className="overflow-x-auto px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-content-secondary">{ev.excerpt}</pre>
                  ) : null}
                </li>
              ))}
            </ul>
          </PanelSection>
          {item.state === "fixing" && item.containerId ? (
            <PanelSection title="Live fix">
              <p className="px-1 text-[11px] leading-5 text-content-muted">
                Kuma is working this item now — the live stream is playing in the console on the left.{" "}
                <Link
                  href={`/services?container=${encodeURIComponent(item.containerId)}`}
                  className="font-medium text-accent-primary hover:underline"
                >
                  Open the live stream
                </Link>
              </p>
            </PanelSection>
          ) : null}
          {item.state === "posted" ? (
            <PanelSection title="Pull request">
              {item.prUrl ? (
                <a
                  href={item.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mx-1 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-accent-primary hover:underline"
                >
                  <IconGitPullRequest size={13} stroke={2} aria-hidden /> View the posted pull request
                </a>
              ) : (
                <p className="px-1 text-[11px] leading-5 text-content-muted">
                  The pull request has been posted on your repository.
                </p>
              )}
            </PanelSection>
          ) : null}
        </div>

        {/* Triage: only an OPEN item offers actions — everything later is
            driven from the pipeline surfaces (approve on Agents, send on
            Services), keeping one decision per stage. */}
        {item.state === "open" && (
          <footer className="shrink-0 space-y-1.5 border-t border-border-subtle px-3 py-3">
            <button
              type="button"
              onClick={() => act("fix")}
              disabled={busy !== null}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "fix" ? (
                <IconLoader2 size={14} stroke={2} className="animate-spin" aria-hidden />
              ) : (
                <IconGitPullRequest size={14} stroke={2} aria-hidden />
              )}
              {item.kind === "opportunity" ? "Implement it" : "Fix it"}
            </button>
            <button
              type="button"
              onClick={() => act("dismiss")}
              disabled={busy !== null}
              className="inline-flex w-full items-center justify-center rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-secondary transition-colors hover:bg-content-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Dismiss
            </button>
            <p className="text-[10px] leading-4 text-content-muted/80">
              Fixing stages one pull request for this item — nothing posts until you approve it.
            </p>
          </footer>
        )}
      </div>
    </>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
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
          className={`shrink-0 transition-transform duration-150 ${!open ? "-rotate-90" : ""}`}
          aria-hidden
        />
        {title}
      </button>
      {open && <div className="px-2 pb-3">{children}</div>}
    </div>
  );
}
