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
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Kuma console">
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
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Kuma</h2>
        <span className="rounded-full border border-border-default px-1.5 py-px text-[10px] font-medium text-content-muted">
          {PHASE_LABEL[view.phase]}
        </span>
        {isSample && (
          <span className="rounded-full border border-accent-warning/30 bg-accent-warning/10 px-1.5 py-px text-[10px] font-medium text-accent-warning">
            Sample
          </span>
        )}
        {/* A real, completed container replays its stored transcript instantly —
            label it honestly so a replay is never mistaken for a live solve. */}
        {!isSample && !live && view.phase !== "idle" && view.phase !== "working" && (
          <span className="rounded-full border border-border-default px-1.5 py-px text-[10px] font-medium text-content-muted">
            Replay
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

/** The visible-thinking pipeline Kuma walks a review through — the glass-box
    workflow, laid out up front the way a Claude Code transcript reads:
    lead line, structured status entries, a prompt line. No chat bubbles. */
const REVIEW_STEPS: { verb: string; detail: string }[] = [
  { verb: "Dispatch", detail: "six specialists — security, performance, quality, tests, deployment, business logic — brief on your change" },
  { verb: "Report", detail: "findings stream in as they land, each with its real confidence score" },
  { verb: "Verify", detail: "every finding is challenged against the actual diff — ✓ kept, ✕ dropped, ⚑ flagged for your judgment" },
  { verb: "Compose", detail: "proven findings are written up; a fix worth making is staged as a pull request" },
  { verb: "Approve", detail: "nothing ships without you — you hold the gate" },
];

function ConsoleEmpty({ connected }: { connected: boolean }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Kuma console">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-primary" aria-hidden />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Kuma</h2>
      </header>

      {/* Kuma introduces itself the way a working engineer's terminal reads —
          full pane, structured lines, no avatar, no bubbles, no waiting talk. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 font-mono text-[12.5px] leading-6">
        <p className="flex items-start gap-2.5">
          <span className="shrink-0 text-accent-primary" aria-hidden>●</span>
          <span className="font-semibold text-content-primary">
            Kuma — your AI Software Healing Engineer
          </span>
        </p>
        <p className="mt-1 max-w-3xl pl-[1.4rem] text-content-secondary">
          I run every review on this account. Six specialists examine each change, I verify their
          findings against the code itself, and I stage the fix. My full reasoning streams here
          while it happens — no black box.
        </p>

        <p className="mt-6 flex items-start gap-2.5">
          <span className="shrink-0 text-content-muted" aria-hidden>●</span>
          <span className="font-semibold text-content-primary">How a review runs</span>
        </p>
        <div className="mt-1 space-y-1 pl-[1.4rem]">
          {REVIEW_STEPS.map((s) => (
            <p key={s.verb} className="flex gap-3">
              <span className="w-20 shrink-0 text-content-primary">{s.verb}</span>
              <span className="max-w-2xl text-content-muted">{s.detail}</span>
            </p>
          ))}
        </div>

        <div className="mt-7 border-t border-border-subtle pt-4">
          {connected ? (
            <p className="flex items-start gap-2.5 text-content-secondary">
              <span className="shrink-0 text-accent-primary" aria-hidden>❯</span>
              Select a pull request on the left — the review streams here as I work.
            </p>
          ) : (
            <Link
              href="/connections"
              className="group inline-flex items-center gap-2.5 text-accent-primary transition-colors hover:text-accent-primary/80"
            >
              <span aria-hidden>❯</span>
              Connect a repository to put me to work
              <IconArrowRight size={14} stroke={2} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
