"use client";

import { useState, useEffect, useRef } from "react";
import {
  IconShieldCheck,
  IconGauge,
  IconBriefcase,
  IconTestPipe,
  IconRocket,
  IconSparkles,
  IconGitBranch,
  IconCheck,
  IconLoader2,
  IconArrowRight,
  IconChevronDown,
} from "@tabler/icons-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Hero-scale, self-contained INTERACTIVE illustration of Kuma's product for
 * the marketing landing page — a framed "app window" preview of the /agents
 * review interface (agents rail · code-fix viewer · verified findings). Takes
 * NO props and reads NO account data: everything below is fixed, illustrative
 * sample content chosen to read well, and the surrounding hero labels the panel
 * "Illustrative example" so a visitor can never mistake it for real activity
 * (mirrors the "sample data" pattern in docs/design-references/).
 *
 * Interaction: click a finding on the right to see the exact code fix Kuma
 * proposes for it (before → after diff) in the centre pane. This demonstrates
 * what a verified solution looks like without touching any real repository.
 *
 * The six agents map 1:1 to the real specialists in
 * packages/agents/src/arete_agents/agents/*.py. Styled entirely with the shared
 * design tokens, so it inherits the active Marble & Ink theme automatically.
 */

type IconType = React.ComponentType<{ size?: number; stroke?: number; className?: string; "aria-hidden"?: boolean }>;

interface DiffLine {
  type: "context" | "remove" | "add";
  text: string;
}

interface Finding {
  id: string;
  agent: string;
  icon: IconType;
  severity: "Critical" | "High" | "Medium";
  file: string;
  line: number;
  title: string;
  rationale: string;
  diff: DiffLine[];
}

const FINDINGS: Finding[] = [
  {
    id: "sec-1",
    agent: "Security",
    icon: IconShieldCheck,
    severity: "Critical",
    file: "src/auth/session.ts",
    line: 42,
    title: "Refresh token stored in localStorage",
    rationale:
      "localStorage is readable by any script on the page, so an XSS bug would leak long-lived refresh tokens. Move it to an httpOnly cookie the browser never exposes to JS.",
    diff: [
      { type: "context", text: "export function persistSession(token: string) {" },
      { type: "remove", text: "  localStorage.setItem('refresh_token', token)" },
      { type: "add", text: "  cookies().set('refresh_token', token, {" },
      { type: "add", text: "    httpOnly: true, secure: true, sameSite: 'lax'," },
      { type: "add", text: "  })" },
      { type: "context", text: "}" },
    ],
  },
  {
    id: "perf-1",
    agent: "Performance",
    icon: IconGauge,
    severity: "High",
    file: "src/orders/list.ts",
    line: 88,
    title: "N+1 query inside the order loop",
    rationale:
      "Each iteration issues its own query, so a 500-order page fires 500 round-trips. Fetch them in one batched query instead.",
    diff: [
      { type: "remove", text: "for (const id of ids) {" },
      { type: "remove", text: "  orders.push(await db.order.findUnique({ where: { id } }))" },
      { type: "remove", text: "}" },
      { type: "add", text: "const orders = await db.order.findMany({" },
      { type: "add", text: "  where: { id: { in: ids } }," },
      { type: "add", text: "})" },
    ],
  },
  {
    id: "biz-1",
    agent: "Business Logic",
    icon: IconBriefcase,
    severity: "High",
    file: "src/billing/charge.ts",
    line: 23,
    title: "Charge is missing an idempotency key",
    rationale:
      "A retried request would charge the customer twice. Sentry shows this path already retries on timeout — pass the order id as the idempotency key.",
    diff: [
      { type: "context", text: "await stripe.charges.create(" },
      { type: "context", text: "  { amount, currency: 'usd' }," },
      { type: "remove", text: ")" },
      { type: "add", text: "  { idempotencyKey: order.id }," },
      { type: "add", text: ")" },
    ],
  },
  {
    id: "test-1",
    agent: "Test Coverage",
    icon: IconTestPipe,
    severity: "Medium",
    file: "src/orders/refund.ts",
    line: 15,
    title: "New refund branch has no test",
    rationale:
      "The partial-refund path added in this diff isn't covered. Add a case so the rounding behaviour can't silently regress.",
    diff: [
      { type: "add", text: "it('refunds a partial amount', async () => {" },
      { type: "add", text: "  const r = await refund(order, 4.5)" },
      { type: "add", text: "  expect(r.amount).toBe(450)" },
      { type: "add", text: "})" },
    ],
  },
];

// Descriptions match landing-sections.tsx's AGENTS grid / agent-catalog.ts's
// `description` field verbatim — same wording everywhere this list appears.
const AGENTS = [
  { label: "Security", icon: IconShieldCheck, note: "3 findings", active: true, description: "Scans for vulnerabilities and OWASP-class issues." },
  { label: "Performance", icon: IconGauge, note: "2 findings", active: true, description: "Flags algorithmic and resource-usage regressions." },
  { label: "Quality", icon: IconSparkles, note: "clear", active: false, description: "Reviews style, readability, and maintainability." },
  { label: "Test Coverage", icon: IconTestPipe, note: "1 finding", active: true, description: "Checks whether behavior changes are actually tested." },
  { label: "Deployment Safety", icon: IconRocket, note: "clear", active: false, description: "Looks for migration, rollout, and config risks." },
  { label: "Business Logic", icon: IconBriefcase, note: "3 findings", active: true, description: "Checks your diff against connected production signals." },
];

const SEVERITY_CLASS: Record<Finding["severity"], string> = {
  Critical: "border-accent-danger/25 bg-accent-danger/10 text-accent-danger",
  High: "border-accent-warning/25 bg-accent-warning/10 text-accent-warning",
  Medium: "border-accent-info/25 bg-accent-info/10 text-accent-info",
};

const SEVERITY_DOT: Record<Finding["severity"], string> = {
  Critical: "bg-accent-danger",
  High: "bg-accent-warning",
  Medium: "bg-accent-info",
};

export function HeroAgentGraph() {
  const [selectedId, setSelectedId] = useState(FINDINGS[0].id);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(true);
  const [thinkingStep, setThinkingStep] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-play: fire the Synthesizer thinking animation shortly after mount.
  // The hero is always at the top of the page, so no IntersectionObserver needed.
  const hasAutoPlayedRef = useRef(false);
  useEffect(() => {
    if (hasAutoPlayedRef.current) return;
    hasAutoPlayedRef.current = true;
    const timer = setTimeout(() => {
      setIsThinking(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleSelectFinding = (id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setThinkingStep(0);
    setIsThinking(true);
  };

  useEffect(() => {
    if (isThinking) {
      // thinkingStep is already 0 here: both callers that flip isThinking to
      // true (handleSelectFinding below, and the autoplay effect above) reset
      // it in the same synchronous batch before this effect runs, so no
      // separate setState is needed at the top of the effect body.
      const timers = [
        setTimeout(() => setThinkingStep(1), 700),
        setTimeout(() => setThinkingStep(2), 1400),
        setTimeout(() => setThinkingStep(3), 2100),
        setTimeout(() => {
          setThinkingStep(4);
          setTimeout(() => setIsThinking(false), 500);
        }, 2800),
      ];
      return () => timers.forEach(clearTimeout);
    }
  }, [isThinking, selectedId]);

  const selected = FINDINGS.find((f) => f.id === selectedId) ?? FINDINGS[0];
  const SelectedIcon = selected.icon;

  const THOUGHT_STEPS = [
    `Reading ${selected.file}`,
    `Analyzing AST context`,
    `Synthesizing code patch`,
    `Verifying against guidelines`,
  ];

  return (
    <motion.div 
      ref={containerRef} 
      className="overflow-hidden rounded-2xl border bg-surface-1"
      animate={{
        boxShadow: [
          "0 30px 80px -30px rgba(26,27,24,0.35), 0 0 0px rgba(0,212,255,0)",
          "0 30px 80px -30px rgba(26,27,24,0.35), 0 0 25px rgba(0,212,255,0.15)",
          "0 30px 80px -30px rgba(26,27,24,0.35), 0 0 0px rgba(0,212,255,0)"
        ],
        borderColor: [
          "rgba(255,255,255,0.1)", // approximate border-default
          "rgba(0,212,255,0.3)",
          "rgba(255,255,255,0.1)"
        ]
      }}
      transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
    >
      {/* App-window title bar */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-2/70 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-content-muted/30" />
          <span className="h-3 w-3 rounded-full bg-content-muted/30" />
          <span className="h-3 w-3 rounded-full bg-content-muted/30" />
        </span>
        <span className="mx-auto rounded-md border border-border-subtle bg-surface-0/60 px-4 py-1 font-mono text-xs text-content-muted">
          app.arete.ai/reviews/142
        </span>
        <span className="shrink-0 rounded-full border border-border-default bg-surface-2 px-2 py-0.5 text-[10px] font-medium tracking-wide text-content-muted">
          Illustrative
        </span>
      </div>

      {/* Three-pane body — expansive height so it reads like the real dashboard */}
      <div className="grid min-h-[520px] grid-cols-1 divide-y divide-border-subtle lg:min-h-[600px] lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(240px,300px)] lg:divide-x lg:divide-y-0">
        {/* Left: agents rail */}
        <motion.div 
          className="min-w-0"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">Agents</span>
            <span className="font-mono text-[10px] text-content-muted">6</span>
          </div>
          <ul className="py-1">
            {AGENTS.map((a) => {
              const Icon = a.icon;
              const expanded = expandedAgent === a.label;
              const isThisAgentThinking = isThinking && selected.agent === a.label;
              return (
                <li key={a.label} className="border-b border-border-subtle last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpandedAgent((cur) => (cur === a.label ? null : a.label))}
                    aria-expanded={expanded}
                    className={`flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-content-primary/[0.03] ${isThisAgentThinking ? "bg-content-primary/[0.02]" : ""}`}
                  >
                    {isThisAgentThinking ? (
                      <motion.div
                        animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }}
                        transition={{ repeat: Infinity, duration: 1 }}
                        className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent-primary shadow-[0_0_8px_rgba(var(--accent-primary),0.8)]"
                        aria-hidden
                      />
                    ) : (
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${a.active ? "bg-accent-success" : "bg-content-muted/40"}`}
                        aria-hidden
                      />
                    )}
                    <Icon size={14} stroke={1.75} className={`mt-0.5 shrink-0 ${isThisAgentThinking ? "text-accent-primary" : "text-content-muted"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      {/* Full name, never truncated — wraps rather than cuts off. */}
                      <span className="block text-[13px] font-medium leading-snug text-content-secondary">{a.label}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-content-muted">{a.active ? a.note : "clear"}</span>
                    </span>
                    <IconChevronDown
                      size={12}
                      stroke={2}
                      className={`mt-1 shrink-0 text-content-muted transition-transform ${expanded ? "" : "-rotate-90"}`}
                      aria-hidden
                    />
                  </button>
                  {expanded && (
                    <p className="px-4 pb-2.5 pl-[2.6rem] text-[11px] leading-relaxed text-content-muted">
                      {a.description}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </motion.div>

        {/* Center: the selected finding's code fix (before → after) */}
        <motion.div 
          className="flex min-w-0 flex-col"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
        >
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-success" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">Proposed fix</span>
            <span className="rounded-full border border-accent-info/25 bg-accent-info/10 px-1.5 py-px text-[10px] font-medium text-accent-info">
              Verified against the diff
            </span>
          </div>

          <div className="flex-1 px-4 py-4 relative">
            <AnimatePresence mode="wait">
              {isThinking ? (
                <motion.div
                  key="thinking"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 flex flex-col justify-center px-8 z-10 bg-surface-1"
                >
                  <div className="flex items-center gap-2 mb-6">
                    <SelectedIcon size={18} stroke={1.75} className="text-content-secondary" aria-hidden />
                    <span className="text-sm font-semibold text-content-primary">{selected.agent} Synthesizer</span>
                  </div>
                  
                  <div className="flex flex-col gap-3">
                    {THOUGHT_STEPS.map((step, idx) => {
                      const status = thinkingStep > idx ? 'done' : thinkingStep === idx ? 'running' : 'waiting';
                      if (status === 'waiting') return null;
                      
                      return (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-center gap-3 rounded-xl border border-border-default bg-surface-0 px-4 py-3 shadow-sm"
                        >
                          {status === 'done' ? (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-success/10">
                              <IconCheck size={12} className="text-accent-success" stroke={2.5} />
                            </div>
                          ) : (
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                              className="flex h-5 w-5 items-center justify-center text-accent-primary"
                            >
                              <IconLoader2 size={16} stroke={2} />
                            </motion.div>
                          )}
                          <span className={`font-mono text-[12px] ${status === 'done' ? 'text-content-secondary' : 'text-content-primary font-medium'}`}>
                            {step}
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="content"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-default bg-surface-2 text-content-secondary">
                      <SelectedIcon size={15} stroke={1.75} aria-hidden />
                    </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-content-primary">{selected.title}</h3>
                  <span className={`rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${SEVERITY_CLASS[selected.severity]}`}>
                    {selected.severity}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-content-muted">
                  {selected.agent} · {selected.file}:{selected.line}
                </p>
              </div>
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-content-secondary">{selected.rationale}</p>

            {/* Diff viewer */}
            <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface-0">
              <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5">
                <IconGitBranch size={12} stroke={1.75} className="text-content-muted" aria-hidden />
                <span className="font-mono text-[11px] text-content-muted">{selected.file}</span>
              </div>
              <pre className="overflow-x-auto px-1 py-1.5 font-mono text-[11.5px] leading-5">
                {selected.diff.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.type === "add"
                        ? "flex gap-2 rounded bg-accent-success/10 px-2"
                        : l.type === "remove"
                          ? "flex gap-2 rounded bg-accent-danger/10 px-2"
                          : "flex gap-2 px-2"
                    }
                  >
                    <span
                      className={
                        l.type === "add"
                          ? "select-none text-accent-success"
                          : l.type === "remove"
                            ? "select-none text-accent-danger"
                            : "select-none text-content-muted/50"
                      }
                      aria-hidden
                    >
                      {l.type === "add" ? "+" : l.type === "remove" ? "-" : " "}
                    </span>
                    <span
                      className={
                        l.type === "context" ? "text-content-muted" : "text-content-secondary"
                      }
                    >
                      {l.text}
                    </span>
                  </div>
                ))}
              </pre>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-accent-primary/90"
              >
                <IconCheck size={13} stroke={2} aria-hidden />
                Apply fix
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-content-secondary transition-colors hover:bg-content-primary/5"
                  >
                    Copy patch
                  </button>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
          </div>

          {/* Pinned Synthesizer input — same disabled-shell pattern as the
              real /agents console: honest that there's no live model yet. */}
          <div className="border-t border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-2/60 px-3 py-2">
              <span className="font-mono text-xs text-content-muted" aria-hidden>&gt;</span>
              <span className="font-mono text-xs text-content-muted/70">Ask the Synthesizer…</span>
            </div>
          </div>
        </motion.div>

        {/* Right: verified findings — click to view its fix */}
        <motion.div 
          className="flex min-w-0 flex-col"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">Verified findings</span>
            <span className="rounded-md border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium text-accent-primary">
              {FINDINGS.length} shown
            </span>
          </div>

          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
            <IconGitBranch size={13} stroke={1.75} className="shrink-0 text-content-muted" aria-hidden />
            <span className="truncate font-mono text-[11px] text-content-secondary">acme/payments-api</span>
            <span className="ml-auto font-mono text-[10px] text-content-muted">PR #142</span>
          </div>

          <ul className="flex-1 space-y-1 p-2">
            {FINDINGS.map((f) => {
              const Icon = f.icon;
              const isActive = f.id === selectedId;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectFinding(f.id)}
                    aria-pressed={isActive}
                    className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      isActive
                        ? "border-accent-primary/30 bg-accent-primary/[0.06]"
                        : "border-transparent hover:border-border-default hover:bg-content-primary/[0.03]"
                    }`}
                  >
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[f.severity]}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <Icon size={13} stroke={1.75} className="shrink-0 text-content-muted" aria-hidden />
                        <span className="truncate text-[12px] font-medium text-content-primary">{f.title}</span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-content-muted">
                        {f.file}:{f.line}
                      </span>
                    </span>
                    {isActive && <IconArrowRight size={13} stroke={2} className="mt-0.5 shrink-0 text-accent-primary" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-border-subtle p-3">
            <div className="flex items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-2 py-2 text-[11px] font-medium text-white">
              <IconCheck size={12} stroke={2} aria-hidden />
              Approve &amp; post review
            </div>
            <p className="mt-2 text-center text-[10px] text-content-muted">You review and merge on your own terms.</p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
