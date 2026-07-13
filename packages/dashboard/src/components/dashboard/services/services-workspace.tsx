"use client";

import { useState } from "react";
import Link from "next/link";
import {
  IconArrowRight,
  IconCircleCheck,
  IconCopy,
  IconGitPullRequest,
  IconPlugConnected,
  IconX,
} from "@tabler/icons-react";

/**
 * Services "Triage Inbox" workspace. Production signals from CONNECTED
 * telemetry (Sentry, Vercel, Stripe, CI, PostHog) plus Areté's own review
 * findings are compiled and deduped PER SERVICE and shown here, each with the
 * telemetry evidence and the specialist agent's proposed code fix; the human
 * approves.
 *
 * Data comes in as props (the real Service/Issue contract). The authenticated
 * /services page renders it EMPTY by default — no fabricated services or
 * incidents — with an honest empty state that routes to /connections. The
 * SAMPLE_* exports below drive the illustrative marketing preview only.
 */

export type Severity = "critical" | "high" | "medium";

export interface DiffRow {
  kind: "context" | "add" | "remove";
  text: string;
}

export interface Issue {
  id: string;
  serviceId: string;
  source: string; // Sentry | Stripe | CI | Vercel | PostHog | Areté
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
    id: "a1", serviceId: "auth-gateway", source: "Areté", severity: "high",
    status: "Fix proposed", agent: "Security",
    title: "Refresh token written to localStorage",
    occurrences: "312 events", lastSeen: "22m ago", where: "src/auth/session.ts:42",
    summary: "Tokens in localStorage are exposed to any script — an XSS bug would leak long-lived sessions.",
    evidence: { file: "Areté review · Security · PR #418", rows: [["storage", "localStorage"], ["token_ttl", "30 days"], ["risk", "XSS → session theft"]] },
    fix: { file: "src/auth/session.ts", rows: [
      { kind: "remove", text: "localStorage.setItem('refresh', token)" },
      { kind: "add", text: "cookies().set('refresh', token, {" },
      { kind: "add", text: "  httpOnly: true, secure: true })" },
    ] },
    timeline: [
      { tone: "high", text: "Flagged on PR #418", when: "Areté · 22m ago" },
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
const TONE_DOT: Record<string, string> = {
  critical: "bg-accent-danger", high: "bg-accent-warning", medium: "bg-accent-info",
  good: "bg-accent-success", accent: "bg-accent-primary",
};

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
 * Embedded (full-bleed) triage workspace. When no services are connected it
 * renders an honest empty state that routes to /connections — never fabricated
 * sample rows. The marketing preview passes SAMPLE_* + variant="framed" to
 * show the populated UI inside a card.
 */
export function ServicesWorkspace({ services = [], issues = [], variant = "embedded" }: ServicesWorkspaceProps) {
  const [serviceId, setServiceId] = useState<string | null>(services[0]?.id ?? null);
  const [issueId, setIssueId] = useState<string | null>(
    issues.find((i) => i.serviceId === services[0]?.id)?.id ?? null
  );

  const hasServices = services.length > 0;
  const activeService = serviceId ?? services[0]?.id ?? null;
  const serviceIssues = activeService ? issues.filter((i) => i.serviceId === activeService) : [];
  const selected = serviceIssues.find((i) => i.id === issueId) ?? serviceIssues[0] ?? null;

  function selectService(id: string) {
    setServiceId(id);
    const first = issues.find((i) => i.serviceId === id);
    setIssueId(first ? first.id : null);
  }

  const outerClass =
    variant === "embedded"
      ? "-m-8 grid min-h-[540px] grid-cols-1 divide-y divide-border-subtle border-t border-border-subtle bg-surface-1/20 overflow-hidden lg:h-[calc(100vh-4.5rem)] lg:min-h-0 lg:grid-cols-[210px_minmax(0,1fr)_minmax(0,1.1fr)] lg:divide-x lg:divide-y-0"
      : "grid min-h-[560px] grid-cols-1 divide-y divide-border-subtle overflow-hidden lg:grid-cols-[210px_minmax(0,1fr)_minmax(0,1.1fr)] lg:divide-x lg:divide-y-0";

  return (
    // "embedded": full-bleed, cancels the dashboard shell's p-8 (the /agents
    // pattern). "framed": fixed height, no negative margin, for the marketing
    // preview card.
    <div className={outerClass}>
      {/* Services rail */}
      <aside className="min-w-0">
        <div className="flex h-10 items-center justify-between border-b border-border-subtle px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">Services</span>
          <span className="font-mono text-[10px] text-content-muted">{services.length}</span>
        </div>
        {hasServices ? (
          <ul>
            {services.map((s) => {
              const on = s.id === activeService;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => selectService(s.id)}
                    className={`flex w-full items-center gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left transition-colors ${
                      on ? "bg-accent-primary/[0.06] shadow-[inset_2px_0_0_var(--color-accent-primary)]" : "hover:bg-content-primary/[0.04]"
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[s.worst]}`} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-content-primary">{s.id}</span>
                    {s.open > 0 ? (
                      <span className={`rounded-full border px-1.5 text-[10px] font-bold ${SEV_PILL[s.worst as Severity]}`}>{s.open}</span>
                    ) : (
                      <span className="font-mono text-[10px] text-content-muted">clear</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-[11.5px] leading-relaxed text-content-muted">
            Your connected services will list here.
          </p>
        )}
      </aside>

      {/* Issue stream */}
      <section className="min-w-0">
        <div className="flex h-10 items-center justify-between border-b border-border-subtle px-3">
          <span className="font-mono text-[12px] text-content-secondary">
            {hasServices ? `${activeService} · issues` : "Issues"}
          </span>
          {serviceIssues.length > 0 && (
            <span className="text-[10.5px] text-content-muted">{serviceIssues.length} open</span>
          )}
        </div>
        {!hasServices ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-primary/20 bg-accent-primary/10 text-accent-primary">
              <IconPlugConnected size={22} stroke={1.75} />
            </span>
            <div className="max-w-xs">
              <h3 className="font-serif text-base font-semibold text-content-primary">No services connected yet</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-content-muted">
                Connect Sentry, Vercel, Stripe, CI, or PostHog and Areté compiles their issues here, per
                service, with a fix already proposed.
              </p>
            </div>
            <Link
              href="/connections"
              className="group inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-accent-primary px-4 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-accent-primary/90"
            >
              Add your services
              <IconArrowRight size={14} stroke={2} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        ) : serviceIssues.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-content-muted">All clear — no open issues for this service.</p>
        ) : (
          <ul>
            {serviceIssues.map((i) => {
              const on = i.id === selected?.id;
              return (
                <li key={i.id} className="grid grid-cols-[3px_1fr] border-b border-border-subtle">
                  <span className={`${SEV_DOT[i.severity]} rounded-r`} aria-hidden />
                  <button
                    type="button"
                    onClick={() => setIssueId(i.id)}
                    className={`px-3 py-2.5 text-left transition-colors ${on ? "bg-accent-primary/[0.06]" : "hover:bg-content-primary/[0.04]"}`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`rounded-full border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide ${SEV_PILL[i.severity]}`}>{SEV_LABEL[i.severity]}</span>
                      <span className="rounded border border-border-default bg-surface-2 px-1.5 text-[10px] font-medium text-content-secondary">{i.source}</span>
                      <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-content-muted">
                        <span className="h-1 w-1 rounded-full bg-accent-primary" />{i.status}
                      </span>
                    </div>
                    <p className="text-[13px] font-semibold leading-tight text-content-primary">{i.title}</p>
                    <p className="mt-1 font-mono text-[11px] text-content-muted">{i.occurrences} · {i.lastSeen} · {i.agent}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Detail */}
      <section className="min-w-0">
        {!selected ? (
          <p className="px-4 py-10 text-sm text-content-muted">
            {hasServices
              ? "Select an issue to see what happened and the proposed fix."
              : "An issue's evidence and proposed fix will appear here."}
          </p>
        ) : (
          <IssueDetail issue={selected} />
        )}
      </section>
    </div>
  );
}

function IssueDetail({ issue }: { issue: Issue }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center justify-between border-b border-border-subtle px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">Issue</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent-primary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary" />{issue.agent} agent
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <div>
          <span className={`rounded-full border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide ${SEV_PILL[issue.severity]}`}>{SEV_LABEL[issue.severity]}</span>
          <h3 className="mt-1.5 font-serif text-lg font-semibold leading-tight text-content-primary">{issue.title}</h3>
          <p className="mt-1 font-mono text-[11px] text-content-muted">{issue.source} · {issue.where} · {issue.occurrences} · {issue.lastSeen}</p>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted">What happened</p>
          <p className="mb-2 text-[13px] leading-relaxed text-content-secondary">{issue.summary}</p>
          <div className="overflow-hidden rounded-lg border border-border-default bg-surface-2">
            <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[11px] text-content-muted">{issue.evidence.file}</div>
            <pre className="overflow-x-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed text-content-secondary">
              {issue.evidence.rows.map(([k, v], idx) => (
                <div key={idx}>
                  <span className="text-content-muted">{k}</span> = <span className={/null|missing|theft|500/.test(v) ? "text-accent-danger" : ""}>{v}</span>
                </div>
              ))}
            </pre>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
            Proposed fix <span className="font-normal normal-case tracking-normal text-accent-info">· verified against the diff</span>
          </p>
          <div className="overflow-hidden rounded-lg border border-border-default bg-surface-2">
            <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[11px] text-content-muted">{issue.fix.file}</div>
            <pre className="overflow-x-auto py-1 font-mono text-[11.5px] leading-relaxed">
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
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-primary/90">
              <IconCircleCheck size={14} stroke={2} /> Approve &amp; open PR
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-content-secondary transition-colors hover:bg-content-primary/5">
              <IconCopy size={14} stroke={1.75} /> Copy patch
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-content-secondary transition-colors hover:bg-content-primary/5">
              <IconX size={14} stroke={1.75} /> Dismiss
            </button>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-content-muted">Activity</p>
          <ol>
            {issue.timeline.map((t, idx) => (
              <li key={idx} className="grid grid-cols-[16px_1fr] gap-2.5 pb-3">
                <div className="flex flex-col items-center">
                  <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${TONE_DOT[t.tone]}`} />
                  {idx < issue.timeline.length - 1 && <span className="mt-1 w-0.5 flex-1 bg-border-default" />}
                </div>
                <div>
                  <p className="text-[12px] text-content-secondary">{t.text}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-content-muted">{t.when}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border-default bg-surface-2 px-3 py-2 text-[11px] text-content-muted">
          <IconGitPullRequest size={14} stroke={1.75} className="mt-0.5 shrink-0" />
          You review and merge on your own terms — Areté never changes your code without approval.
        </div>
      </div>
    </div>
  );
}
