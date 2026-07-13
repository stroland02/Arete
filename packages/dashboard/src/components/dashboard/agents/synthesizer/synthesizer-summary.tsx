"use client";

import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { IconArrowRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { isSampleContainerId } from "@/lib/issue-pipeline/sample-containers";
import { useSynthStream } from "./use-synth-stream";
import { shouldAnimate } from "./synth-transcript-visual";
import { SynthProgress } from "./synth-progress";
import { SynthAgentsRail } from "./synth-agents-rail";
import { SynthLedger } from "./synth-ledger";
import type { SynthPhase } from "./synth-phase";

/**
 * Services big-picture variant (spec §3, "Services variant"). A condensed
 * projection of the SAME container/stream the Agents console shows — no
 * transcript detail: phase progress, which specialists worked, the verdict
 * counts, the Post-PR gate, and a deep-link into the focused Agents view (the
 * §4 handoff). Big picture = the *what*; the detailed *how* is one click away.
 */
export function SynthesizerSummary({ containerId }: { containerId: string }) {
  // key by container so switching issues resets the stream (see use-synth-stream).
  return <SummaryStream key={containerId} containerId={containerId} />;
}

const STATUS: Record<SynthPhase, string> = {
  idle: "Detected — queued for review",
  working: "Agents are solving this issue",
  ready: "Verified — ready to post",
  done: "Pull request posted",
  dismissed: "Dismissed",
};

function SummaryStream({ containerId }: { containerId: string }) {
  const view = useSynthStream(containerId);
  const reducedMotion = useReducedMotion();
  const animating = shouldAnimate(view.phase, Boolean(reducedMotion));
  const isSample = isSampleContainerId(containerId);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-1/40 p-3" aria-label="Synthesizer summary">
      <header className="flex items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            view.phase === "working"
              ? "bg-accent-info motion-safe:animate-pulse"
              : view.phase === "ready"
                ? "bg-accent-success"
                : view.phase === "done"
                  ? "bg-accent-primary"
                  : "bg-content-muted/40",
          )}
          aria-hidden
        />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">Synthesizer</h3>
        {isSample && (
          <span className="rounded-full border border-accent-warning/30 bg-accent-warning/10 px-1.5 py-px text-[10px] font-medium text-accent-warning">
            Sample
          </span>
        )}
        <span className="ml-auto text-[11px] text-content-muted">{STATUS[view.phase]}</span>
      </header>

      <SynthProgress phase={view.phase} />

      <div className="flex gap-3">
        <SynthAgentsRail reportedAgentIds={view.reportedAgentIds} animating={animating} />
        <div className="min-w-0 flex-1">
          <SynthLedger
            kept={view.kept}
            dropped={view.dropped}
            needsAttention={view.needsAttention}
            ready={view.ready}
            gateLabel="Post pull request"
            gateHint="Posting sends the reviewed PR to your repository — the send gate."
          />
        </div>
      </div>

      <Link
        href={`/agents?container=${encodeURIComponent(containerId)}`}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-2/60 px-3 py-2 text-[12px] font-medium text-content-secondary transition-colors hover:text-content-primary"
      >
        See how the agents solved this
        <IconArrowRight size={13} stroke={2} className="text-accent-primary" aria-hidden />
      </Link>
    </section>
  );
}
