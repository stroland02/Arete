"use client";

import { motion } from "framer-motion";
import { IconLoader2 } from "@tabler/icons-react";
import type { SynthStep } from "@/lib/issue-pipeline/types";
import { fadeSlideUp, staggerContainer } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { stepVisual, type StepTone } from "./synth-transcript-visual";

/**
 * Center of the Synthesizer console (spec §2, §4): the streamed verification
 * transcript. Each SynthStep renders as a line — verify spins on the live edge,
 * keep/drop resolve with a marker + real file:line, a flagged keep shows the ⚑
 * "wants a human look" note. `animating` (computed by the parent from phase +
 * reduced-motion) gates BOTH the entry motion and the spinner, so a finished or
 * reduced-motion view shows the final state with no spinners (tested in
 * synth-transcript-visual.test.ts).
 */

const TONE_CLASS: Record<StepTone, string> = {
  primary: "text-accent-primary",
  info: "text-accent-info",
  success: "text-accent-success",
  danger: "text-accent-danger",
  attention: "text-accent-warning",
  muted: "text-content-muted",
};

export function SynthTranscript({ steps, animating }: { steps: SynthStep[]; animating: boolean }) {
  return (
    <motion.ol
      className="space-y-0.5 font-mono text-xs"
      variants={staggerContainer}
      initial={animating ? "hidden" : false}
      animate="show"
    >
      {steps.map((step, i) => {
        const v = stepVisual(step, { isLast: i === steps.length - 1, animate: animating });
        return (
          <motion.li
            key={`${i}-${step.kind}-${step.findingId ?? ""}`}
            variants={animating ? fadeSlideUp : undefined}
            className="rounded-md px-2 py-1.5 hover:bg-content-primary/[0.03]"
          >
            <div className="flex items-start gap-2.5">
              <span className={cn("shrink-0 leading-4", TONE_CLASS[v.tone])} aria-hidden>
                {v.showSpinner ? (
                  <IconLoader2 size={13} stroke={2} className="animate-spin" />
                ) : (
                  v.marker
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-content-secondary", v.needsAttention && "text-accent-warning")}>
                  {step.text}
                </p>
                {step.detail && (
                  <p className="mt-0.5 text-[11px] leading-4 text-content-muted">{step.detail}</p>
                )}
                {v.needsAttention && (
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-warning/90">
                    Wants a human look
                  </p>
                )}
              </div>
            </div>
          </motion.li>
        );
      })}
    </motion.ol>
  );
}
