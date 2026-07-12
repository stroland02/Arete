import {
  IconShieldCheck,
  IconGauge,
  IconSparkles,
  IconTestPipe,
  IconRocket,
  IconBriefcase,
  IconGitBranch,
  IconCheck,
} from "@tabler/icons-react";

// A static, presentational, FULL-WIDTH preview of the Areté /agents interface,
// framed as an app window — the "card interface" preview for the marketing
// landing page (Tsenta/Orca pattern: a big readable dashboard card below the
// hero copy). Purely illustrative: no real data, no interactivity. It mirrors
// the real three-pane workspace (agents rail · Synthesizer console · PR panel)
// at legible size so a visitor sees what the product actually looks like.

const PREVIEW_AGENTS = [
  { label: "Security", tier: "Opus", icon: IconShieldCheck, active: true, note: "3 findings" },
  { label: "Performance", tier: "Sonnet", icon: IconGauge, active: true, note: "2 findings" },
  { label: "Quality", tier: "Sonnet", icon: IconSparkles, active: false, note: "clear" },
  { label: "Test Coverage", tier: "Sonnet", icon: IconTestPipe, active: true, note: "1 finding" },
  { label: "Deployment Safety", tier: "Opus", icon: IconRocket, active: false, note: "clear" },
  { label: "Business Logic", tier: "Opus", icon: IconBriefcase, active: true, note: "3 findings" },
];

const PREVIEW_STEPS = [
  {
    marker: "●",
    tone: "text-accent-primary",
    text: "Review started — 6 specialists dispatched in parallel",
    detail: "security · performance · quality · tests · deploys · business logic",
  },
  {
    marker: "●",
    tone: "text-accent-primary",
    text: "Security reported 3 findings",
    detail: "candidate findings handed to the Synthesizer",
  },
  {
    marker: "✱",
    tone: "text-accent-info",
    text: "Verifying each finding against the diff…",
    detail: "low-confidence and off-diff findings are dropped here",
  },
  {
    marker: "✓",
    tone: "text-accent-success",
    text: "9 verified findings posted to the PR",
    detail: "2 low-confidence findings dropped before they reached you",
  },
];

const TIER_CLASS: Record<string, string> = {
  Opus: "border-accent-primary/25 bg-accent-primary/10 text-accent-primary",
  Sonnet: "border-white/10 bg-white/5 text-content-secondary",
};

export function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-surface-1/80 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.7)] backdrop-blur-md">
      {/* App-window title bar */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-2/60 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-red-400/70" />
          <span className="h-3 w-3 rounded-full bg-amber-400/70" />
          <span className="h-3 w-3 rounded-full bg-green-400/70" />
        </span>
        <span className="mx-auto rounded-md border border-border-subtle bg-black/20 px-4 py-1 font-mono text-xs text-content-muted">
          app.arete.ai/agents
        </span>
      </div>

      {/* Three-pane body — real proportions, legible text */}
      <div className="grid grid-cols-1 divide-y divide-border-subtle md:grid-cols-[minmax(200px,240px)_minmax(0,1fr)_minmax(220px,280px)] md:divide-x md:divide-y-0">
        {/* Left: agents rail */}
        <div className="min-w-0">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
              Agents
            </span>
            <span className="font-mono text-[10px] text-content-muted">6</span>
          </div>
          <ul className="py-1.5">
            {PREVIEW_AGENTS.map((a) => {
              const Icon = a.icon;
              return (
                <li key={a.label} className="flex items-start gap-2.5 px-4 py-2">
                  <span
                    className={
                      a.active
                        ? "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-success shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                        : "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-content-muted/40"
                    }
                    aria-hidden
                  />
                  <span className="mt-0.5 shrink-0 text-content-muted" aria-hidden>
                    <Icon size={14} stroke={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-content-secondary">
                        {a.label}
                      </span>
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-medium ${TIER_CLASS[a.tier]}`}
                      >
                        {a.tier}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-content-muted">
                      {a.active ? `Analyzed · ${a.note}` : "Idle · clear"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Center: Synthesizer console */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-success shadow-[0_0_6px_rgba(52,211,153,0.8)]" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
              Synthesizer
            </span>
            <span className="rounded-full border border-accent-info/25 bg-accent-info/10 px-1.5 py-px text-[10px] font-medium text-accent-info">
              Preview
            </span>
          </div>
          <ol className="space-y-1 px-4 py-3 font-mono text-[13px]">
            {PREVIEW_STEPS.map((s) => (
              <li key={s.text} className="rounded-md px-2 py-1.5">
                <div className="flex items-start gap-2.5">
                  <span className={`shrink-0 leading-5 ${s.tone}`} aria-hidden>
                    {s.marker}
                  </span>
                  <div className="min-w-0">
                    <p className="text-content-secondary">{s.text}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-content-muted">{s.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mx-4 mb-4 flex items-center gap-2 rounded-lg border border-border-default bg-surface-2/60 px-3 py-2">
            <span className="font-mono text-xs text-content-muted" aria-hidden>&gt;</span>
            <span className="font-mono text-xs text-content-muted/70">Ask the Synthesizer…</span>
          </div>
        </div>

        {/* Right: PR panel */}
        <div className="min-w-0">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
              Pull Request
            </span>
            <span className="rounded-md border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium text-accent-primary">
              View PR
            </span>
          </div>
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-2/60 px-2.5 py-1.5">
              <IconGitBranch size={13} stroke={1.75} className="shrink-0 text-content-muted" aria-hidden />
              <span className="truncate font-mono text-[11px] text-content-secondary">acme/payments-api</span>
            </div>
            <p className="font-mono text-[11px] text-content-muted">PR #142 · vs main</p>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-content-muted">Findings</p>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
                <span className="text-content-secondary">Medium risk</span>
                <span className="ml-auto text-content-muted">9 verified</span>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">Human verification</p>
              <div className="flex items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-2 py-1.5 text-[11px] font-medium text-white">
                <IconCheck size={12} stroke={2} aria-hidden />
                Approve &amp; post review
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-lg border border-border-default bg-surface-2/60 py-1.5 text-center text-[10px] text-content-secondary">
                  Request changes
                </div>
                <div className="rounded-lg border border-border-default bg-surface-2/60 py-1.5 text-center text-[10px] text-content-secondary">
                  Post to PR
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
