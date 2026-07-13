"use client";

import { cn } from "@/lib/utils";
import type { SynthPhase } from "./synth-phase";

/**
 * Top phase bar for the Synthesizer console (spec §3). Four stages the review
 * moves through; the bar fills and the active stage lights as `phase` advances.
 * Phase-driven (not container.state) so the fill stays consistent with the
 * streamed transcript on a live container.
 */

const STAGES = ["Dispatch", "Verify", "Compose", "Ready"] as const;

/** Active stage index per phase — how far the bar has filled. */
function activeIndex(phase: SynthPhase): number {
  switch (phase) {
    case "idle":
      return 0;
    case "working":
      return 1; // mid-pipeline (verify) — sub-stage isn't distinguished
    case "ready":
      return 3;
    case "done":
      return 4;
    case "dismissed":
      return -1;
  }
}

export function SynthProgress({ phase }: { phase: SynthPhase }) {
  const idx = activeIndex(phase);
  const fill = idx < 0 ? 0 : Math.min(100, (idx / STAGES.length) * 100 + (phase === "working" ? 16 : 0));
  const working = phase === "working";

  return (
    <div className="shrink-0 border-b border-border-subtle px-3 py-2">
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full bg-accent-primary transition-[width] duration-500 ease-out",
            working && "motion-safe:animate-pulse",
          )}
          style={{ width: `${fill}%` }}
        />
      </div>
      <ol className="mt-1.5 flex items-center justify-between">
        {STAGES.map((label, i) => {
          const reached = idx >= 0 && i <= idx;
          const active = i === idx && phase !== "done";
          return (
            <li
              key={label}
              className={cn(
                "font-mono text-[10px] uppercase tracking-wider transition-colors",
                active
                  ? "text-accent-primary"
                  : reached
                    ? "text-content-secondary"
                    : "text-content-muted/60",
              )}
            >
              {label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
