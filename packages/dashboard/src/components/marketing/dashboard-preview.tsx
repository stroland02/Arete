import {
  IconShieldCheck,
  IconGauge,
  IconSparkles,
  IconTestPipe,
  IconRocket,
  IconBriefcase,
} from "@tabler/icons-react";

// A static, presentational preview of the Areté /agents interface, framed as
// an app window — the "card interface" preview for the marketing landing page.
// Purely illustrative: no real data, no interactivity. It mirrors the real
// three-pane workspace (agents rail · Synthesizer console · PR panel) so a
// visitor sees what the product actually looks like.

const PREVIEW_AGENTS = [
  { label: "Security", tier: "Opus", icon: IconShieldCheck, active: true },
  { label: "Performance", tier: "Sonnet", icon: IconGauge, active: true },
  { label: "Quality", tier: "Sonnet", icon: IconSparkles, active: false },
  { label: "Test Coverage", tier: "Sonnet", icon: IconTestPipe, active: true },
  { label: "Deployment Safety", tier: "Opus", icon: IconRocket, active: false },
  { label: "Business Logic", tier: "Opus", icon: IconBriefcase, active: true },
];

const PREVIEW_STEPS = [
  { marker: "●", tone: "text-accent-primary", text: "6 specialists dispatched in parallel" },
  { marker: "●", tone: "text-accent-primary", text: "Security flagged 3 findings" },
  { marker: "✱", tone: "text-accent-info", text: "Verifying each against the diff…" },
  { marker: "✓", tone: "text-accent-success", text: "9 verified findings posted to the PR" },
];

export function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-surface-1/80 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur-md">
      {/* App-window title bar */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-2/60 px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
        </span>
        <span className="mx-auto rounded-md border border-border-subtle bg-black/20 px-3 py-0.5 font-mono text-[10px] text-content-muted">
          app.arete.ai/agents
        </span>
      </div>

      {/* Three-pane body */}
      <div className="grid grid-cols-[92px_1fr_96px] divide-x divide-border-subtle sm:grid-cols-[120px_1fr_120px]">
        {/* Left: agents rail */}
        <div className="min-w-0">
          <div className="border-b border-border-subtle px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-content-muted">
            Agents
          </div>
          <ul className="py-1">
            {PREVIEW_AGENTS.map((a) => {
              const Icon = a.icon;
              return (
                <li key={a.label} className="flex items-center gap-1.5 px-2.5 py-1.5">
                  <span
                    className={
                      a.active
                        ? "h-1.5 w-1.5 shrink-0 rounded-full bg-accent-success"
                        : "h-1.5 w-1.5 shrink-0 rounded-full bg-content-muted/40"
                    }
                    aria-hidden
                  />
                  <Icon size={11} stroke={1.75} className="shrink-0 text-content-muted" />
                  <span className="truncate text-[10px] text-content-secondary">{a.label}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Center: Synthesizer console */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 border-b border-border-subtle px-2.5 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-success" aria-hidden />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-content-muted">
              Synthesizer
            </span>
            <span className="rounded-full border border-accent-info/25 bg-accent-info/10 px-1 text-[8px] font-medium text-accent-info">
              Preview
            </span>
          </div>
          <ul className="space-y-1.5 px-2.5 py-2.5 font-mono">
            {PREVIEW_STEPS.map((s) => (
              <li key={s.text} className="flex items-start gap-1.5">
                <span className={`shrink-0 text-[10px] leading-4 ${s.tone}`} aria-hidden>
                  {s.marker}
                </span>
                <span className="text-[10px] leading-4 text-content-secondary">{s.text}</span>
              </li>
            ))}
          </ul>
          <div className="mx-2.5 mb-2.5 rounded-md border border-border-default bg-surface-2/60 px-2 py-1 font-mono text-[9px] text-content-muted/70">
            &gt; Ask the Synthesizer…
          </div>
        </div>

        {/* Right: PR panel */}
        <div className="min-w-0">
          <div className="border-b border-border-subtle px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-content-muted">
            Pull Request
          </div>
          <div className="space-y-2 px-2.5 py-2">
            <div className="rounded-md border border-accent-primary/25 bg-accent-primary/10 px-1.5 py-1 text-center text-[9px] font-medium text-accent-primary">
              View PR
            </div>
            <div className="flex items-center gap-1.5 text-[9px] text-content-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
              Medium risk
            </div>
            <div className="text-[9px] uppercase tracking-wider text-content-muted">Findings</div>
            <div className="h-1 w-full rounded bg-white/10" />
            <div className="h-1 w-3/4 rounded bg-white/10" />
            <div className="mt-1 text-[9px] uppercase tracking-wider text-content-muted">Files</div>
            <div className="h-1 w-2/3 rounded bg-white/10" />
          </div>
        </div>
      </div>
    </div>
  );
}
