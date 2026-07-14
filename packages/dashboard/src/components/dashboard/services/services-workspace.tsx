"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { IconChevronDown, IconCopy, IconGitBranch, IconGitPullRequest, IconHourglassHigh, IconPlus, IconLoader2, IconCheck } from "@tabler/icons-react";
import { KumaLogo } from "@/components/ui/kuma-logo";

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
}

/**
 * Embedded (full-bleed) triage workspace. When no services are connected,
 * the rail's "Connect your tools" list is still real and actionable — never
 * fabricated rows. The marketing preview passes SAMPLE_* + variant="framed"
 * to show the populated UI inside a card.
 */
export function ServicesWorkspace({ services = [], issues = [], variant = "embedded" }: ServicesWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { margin: "-100px 0px -100px 0px" });

  // Guard against hydration: defer observer logic until after first client render
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => { setHasMounted(true); }, []);

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

  return (
    <div ref={containerRef} className={outerClass}>
      {/* Rail: services (each expandable to its issues) + connect catalog */}
      <section className="flex min-h-0 flex-1 flex-col" aria-label="Services">
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Services</h2>
          <span className="font-mono text-[10px] tabular-nums text-content-muted">{services.length}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {hasServices && (
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
                      }`}
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
                                  }`}
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

          <div className="px-3 py-3">
            <Link
              href="/connections"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-2 text-[12px] font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
            >
              <IconPlus size={14} stroke={2} aria-hidden />
              {hasServices ? "Connect more services" : "Connect your services"}
            </Link>
          </div>
        </div>
      </section>

      {/* Center: Synthesizer console, scoped to the selected issue */}
      <section className="flex min-h-0 flex-1 flex-col" aria-label="Synthesizer">
        <IssueSynthesizerConsole issue={selected} isReplaying={isReplaying} replayStep={replayStep} />
      </section>

      {/* Right: the issue's own detail */}
      <section className="flex min-h-0 flex-1 flex-col" aria-label="Issue panel">
        <IssuePanel issue={selected} isReplaying={isReplaying} />
      </section>
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
 * Right pane: the issue's concrete detail — agents involved, evidence, the
 * formatted pull request — repo target, the PR title/body, and the review
 * comment(s) as they'll post — plus the send gate. Per the pipeline spec, the
 * repo target and Post PR / Request changes live HERE (Services), not on Agents.
 */
function IssuePanel({ issue, isReplaying }: { issue: Issue | null; isReplaying: boolean }) {
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
          {/* The big-picture Synthesizer projection (SynthesizerSummary) mounts
              here once a real IssueContainer backs the selected issue — it is
              deliberately NOT wired to sample data, so the product surface never
              shows a fabricated review (connector step unifies Issue↔Container). */}

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
                <div className="overflow-hidden rounded-lg border border-border-default bg-surface-2">
                  <div className="border-b border-border-subtle px-2.5 py-1.5 font-mono text-[10.5px] text-content-muted">{issue.fix.file}</div>
                  <pre className="overflow-x-auto py-1 font-mono text-[11px] leading-relaxed">
                    {issue.fix.rows.map((r, idx) => (
                      <div
                        key={idx}
                        className={`flex gap-2 px-2 ${r.kind === "add" ? "bg-accent-success/10" : r.kind === "remove" ? "bg-accent-danger/10" : ""}`}
                      >
                        <span className={`select-none ${r.kind === "add" ? "text-accent-success" : r.kind === "remove" ? "text-accent-danger" : "text-content-muted/50"}`}>
                          {r.kind === "add" ? "+" : r.kind === "remove" ? "-" : " "}
                        </span>
                        <span className={r.kind === "context" ? "text-content-muted" : "text-content-secondary"}>{r.text}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
            </PanelSection>
          </div>

          <footer className="shrink-0 space-y-2 border-t border-border-subtle px-3 py-3">
            <button type="button" className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-primary/90">
              <IconGitPullRequest size={14} stroke={2} /> Post pull request
            </button>
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
