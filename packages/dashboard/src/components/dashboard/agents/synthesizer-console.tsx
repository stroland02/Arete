"use client";

import { useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { IconArrowRight, IconHourglassHigh, IconPlayerPlay } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { isSampleContainerId, SAMPLE_WORKING_ID } from "@/lib/issue-pipeline/sample-containers";
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
 * NO approve button — it points the human to the Solution panel when ready. The
 * detailed inner rail + ledger + gate live on the Services summary variant.
 *
 * HONESTY: with no real container pipeline yet, the console defaults to the
 * empty/onboarding state; "Watch a sample review" opts into a clearly-labelled
 * ("Sample") live stream of a fixture through the real SSE path — never the
 * user's data, never presented as a real review.
 */
export interface SynthesizerConsoleProps {
  /** Focused container to stream (deep-linked from a Services issue). Null → empty. */
  containerId?: string | null;
}

export function SynthesizerConsole({ containerId = null }: SynthesizerConsoleProps) {
  const [activeId, setActiveId] = useState<string | null>(containerId);
  if (!activeId) {
    return <ConsoleEmpty onSample={() => setActiveId(SAMPLE_WORKING_ID)} />;
  }
  // key resets the stream hook's reducer when the focused container changes.
  return <ConsoleStream key={activeId} containerId={activeId} />;
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
        {isSample && (
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-content-muted">
            Sample review streamed through the real pipeline — not your data
          </p>
        )}
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
            {live ? "verifying findings against the diff…" : "waiting for the review to run"}
          </p>
        )}
      </footer>
    </section>
  );
}

function ConsoleEmpty({ onSample }: { onSample: () => void }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Synthesizer console">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-content-muted/40" aria-hidden />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Synthesizer</h2>
      </header>

      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
        <div className="rounded-2xl border border-border-default bg-content-primary/5 p-3 text-accent-primary">
          <IconHourglassHigh size={24} stroke={1.5} />
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-content-primary">The Synthesizer coordinates every review</p>
          <p className="text-xs leading-5 text-content-muted">
            It gathers findings from all six specialists, then verifies each one against your diff and drops anything not
            backed by real evidence. Only the proven findings reach your pull request — you see signal, not noise.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onSample}
            className="inline-flex items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/15 px-4 py-2 text-sm font-medium text-accent-primary transition-colors hover:bg-accent-primary/25"
          >
            <IconPlayerPlay size={15} stroke={2} />
            Watch a sample review
          </button>
          <Link
            href="/connections"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary transition-colors hover:text-content-primary"
          >
            Connect a repository to run it on your PRs
            <IconArrowRight size={13} stroke={2} />
          </Link>
        </div>
      </div>
    </section>
  );
}
