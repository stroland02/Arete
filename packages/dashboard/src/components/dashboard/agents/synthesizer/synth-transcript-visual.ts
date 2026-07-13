/**
 * Transcript line visuals — pure mapping from a SynthStep to its marker/tone.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §2, §4.
 *
 * Kept framework-free (returns semantic tone tokens + booleans, no Tailwind) so
 * the spinner / reduced-motion rules are unit-testable without a DOM. The .tsx
 * renderer maps `tone` onto classes. The key rule the tests pin: a spinner is
 * shown ONLY while actively animating on the latest line — so reduced motion or
 * a finished stream renders the final state with no spinners.
 */

import type { SynthStep } from "@/lib/issue-pipeline/types";
import type { SynthPhase } from "./synth-phase";

export type StepTone = "primary" | "info" | "success" | "danger" | "attention" | "muted";

export interface StepVisual {
  marker: string;
  tone: StepTone;
  showSpinner: boolean;
  needsAttention: boolean;
}

/** Motion runs only while solving and only when the user allows it (spec §4). */
export function shouldAnimate(phase: SynthPhase, reducedMotion: boolean): boolean {
  return phase === "working" && !reducedMotion;
}

export function stepVisual(step: SynthStep, opts: { isLast: boolean; animate: boolean }): StepVisual {
  switch (step.kind) {
    case "dispatch":
      return { marker: "◆", tone: "primary", showSpinner: false, needsAttention: false };
    case "report":
      return { marker: "▸", tone: "info", showSpinner: false, needsAttention: false };
    case "verify":
      // The currently-processing line spins — but only while genuinely animating.
      return { marker: "○", tone: "muted", showSpinner: opts.animate && opts.isLast, needsAttention: false };
    case "keep":
      return step.needsAttention
        ? { marker: "⚑", tone: "attention", showSpinner: false, needsAttention: true }
        : { marker: "✓", tone: "success", showSpinner: false, needsAttention: false };
    case "drop":
      return { marker: "✕", tone: "muted", showSpinner: false, needsAttention: false };
    case "compose":
      return { marker: "◈", tone: "primary", showSpinner: false, needsAttention: false };
    case "posted":
      return { marker: "✓", tone: "success", showSpinner: false, needsAttention: false };
    default:
      return { marker: "·", tone: "muted", showSpinner: false, needsAttention: false };
  }
}
