"use client";

import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { IconArrowRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { isSampleContainerId } from "@/lib/issue-pipeline/sample-containers";
import { useSynthStream } from "./synthesizer/use-synth-stream";
import { shouldAnimate } from "./synthesizer/synth-transcript-visual";
import { SynthProgress } from "./synthesizer/synth-progress";
import { SynthTranscript } from "./synthesizer/synth-transcript";
import type { SynthPhase } from "./synthesizer/synth-phase";

/**
 * Center pane of the /agents workspace — the Synthesizer's live verification
 * transcript (spec 2026-07-13-synthesizer-component-and-critic §3, "Agents
 * variant"). Streams one container's SynthSteps over SSE and renders them as
 * they arrive: agents report, each candidate is verified against the diff and
 * resolves ✓ kept / ✗ dropped / ⚑ needs-a-look, then the review composes.
 *
 * The left AgentRail (selection) and right PrPanel (the Solution + Approve gate)
 * already frame this pane, so the console deliberately holds NO second rail and
 * NO approve button — it points the human to the Solution panel when ready.
 *
 * HONESTY: the console animates ONLY when a real workflow is running (a real
 * `containerId`, deep-linked from a Services issue). With no live review it
 * shows the onboarding state — it never streams sample/illustrative data into
 * the product surface. (The `isSampleContainerId` chip stays as a guard: if a
 * sample ever reaches this surface it is unmistakably labelled.)
 */
export interface SynthesizerConsoleProps {
  /** Focused container to stream (deep-linked from a Services issue). Null → empty. */
  containerId?: string | null;
  /** Whether a repository is connected — switches the empty state from "connect" to "awaiting review". */
  connected?: boolean;
}

export function SynthesizerConsole({ containerId = null, connected = false }: SynthesizerConsoleProps) {
  if (!containerId) {
    return <ConsoleEmpty connected={connected} />;
  }
  // key resets the stream hook's reducer when the focused container changes.
  return <ConsoleStream key={containerId} containerId={containerId} />;
}

const PHASE_LABEL: Record<SynthPhase, string> = {
  idle: "Idle",
  working: "Verifying",
  ready: "Ready",
  done: "Complete",
  dismissed: "Dismissed",
};

function ConsoleStream({ containerId }: { containerId: string }) {
  const view = useSynthStream(containerId);
  const reducedMotion = useReducedMotion();
  const animating = shouldAnimate(view.phase, Boolean(reducedMotion));
  const isSample = isSampleContainerId(containerId);
  const live = view.phase === "working";

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Synthesizer console">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            live
              ? "bg-accent-info shadow-[0_0_6px_rgba(59,130,246,0.7)] motion-safe:animate-pulse"
              : view.phase === "ready"
                ? "bg-accent-success shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                : "bg-content-muted/40",
          )}
          aria-hidden
        />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Synthesizer</h2>
        <span className="rounded-full border border-border-default px-1.5 py-px text-[10px] font-medium text-content-muted">
          {PHASE_LABEL[view.phase]}
        </span>
        {isSample && (
          <span className="rounded-full border border-accent-warning/30 bg-accent-warning/10 px-1.5 py-px text-[10px] font-medium text-accent-warning">
            Sample
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 font-mono text-[11px] tabular-nums">
          <span className="text-accent-success">✓ {view.kept}</span>
          <span className="text-content-muted">✕ {view.dropped}</span>
          {view.needsAttention > 0 && <span className="text-accent-warning">⚑ {view.needsAttention}</span>}
        </div>
      </header>

      <SynthProgress phase={view.phase} />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <SynthTranscript steps={view.steps} animating={animating} />
      </div>

      <footer className="shrink-0 space-y-1.5 border-t border-border-subtle px-3 py-2.5">
        {view.needsAttention > 0 && (
          <p className="text-[11px] leading-4 text-accent-warning">
            {view.needsAttention} {view.needsAttention === 1 ? "finding wants" : "findings want"} a human look before this ships.
          </p>
        )}
        {view.ready ? (
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-content-secondary">
            Solution ready — approve it in the Solution panel
            <IconArrowRight size={13} stroke={2} className="text-accent-primary" aria-hidden />
          </p>
        ) : (
          <p className="font-mono text-[10px] text-content-muted/80">
            {live ? "verifying findings against the diff…" : "standing by — the review streams here the moment it starts"}
          </p>
        )}
      </footer>
    </section>
  );
}

/** The visible-thinking pipeline the Synthesizer walks a review through — the
    glass-box workflow, introduced up front so the user knows exactly what they
    will watch happen. */
const THINKING_STEPS: { title: string; detail: string }[] = [
  { title: "Dispatch", detail: "I brief six specialist engineers — security, performance, quality, tests, deployment, business logic — on your change." },
  { title: "Specialists report", detail: "Each returns findings with real confidence scores. You see every report as it arrives." },
  { title: "Verify", detail: "I challenge each finding against your actual diff — keep ✓, drop ✕, or flag ⚑ for your judgment." },
  { title: "Compose", detail: "I write up only the proven findings and, when there's a fix worth making, stage it as a pull request." },
  { title: "Your call", detail: "Nothing ships without you. You approve, then I send the PR." },
];

function ConsoleEmpty({ connected }: { connected: boolean }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Synthesizer console">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-primary" aria-hidden />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Synthesizer</h2>
      </header>

      {/* Professional introduction — the Synthesizer presents itself as the AI
          software engineer it is, and shows its thinking process up front.
          No loading/waiting talk: an idle engineer is introduced, not buffering. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex max-w-lg flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent-primary/30 bg-accent-primary/10 font-semibold text-accent-primary">
              S
            </span>
            <div className="rounded-2xl rounded-tl-md border border-border-subtle bg-surface-1 px-4 py-3">
              <p className="text-[13px] leading-relaxed text-content-primary">
                I&apos;m your Synthesizer — the engineer who runs every review on this account. I coordinate six
                specialists, verify their findings against your actual code, and propose fixes for your approval.
                My reasoning is never a black box: when I work, you watch every step of it, live, right here.
              </p>
            </div>
          </div>

          <div className="ml-12 rounded-2xl border border-border-subtle bg-surface-1 px-4 py-3">
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              How I think — visible, every time
            </p>
            <ol className="space-y-2.5">
              {THINKING_STEPS.map((s, i) => (
                <li key={s.title} className="flex items-start gap-2.5">
                  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-primary/10 font-mono text-[10px] font-semibold text-accent-primary">
                    {i + 1}
                  </span>
                  <p className="text-[12px] leading-5 text-content-secondary">
                    <span className="font-semibold text-content-primary">{s.title}.</span> {s.detail}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          <div className="ml-12">
            {connected ? (
              <p className="text-[12px] leading-5 text-content-muted">
                Select a pull request on the left — or open a new one on your connected repository — and my
                review streams here as I work.
              </p>
            ) : (
              <Link
                href="/connections"
                className="inline-flex items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/15 px-4 py-2 text-sm font-medium text-accent-primary transition-colors hover:bg-accent-primary/25"
              >
                Connect a repository to put me to work
                <IconArrowRight size={15} stroke={2} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
