"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { IconChevronDown } from "@tabler/icons-react";

export interface SynthesizerHourglassProps {
  totalFindings: number;
  hasReviews: boolean;
}

/**
 * The central "project manager". The hourglass mirrors the real
 * SynthesizerAgent contract (orchestrator.py + models/review.py): every
 * agent's findings pour into the top bulb, the neck is verification against
 * the actual diff, and only survivors reach the bottom bulb and post to the
 * PR. Low-confidence findings are dropped (`dropped_count`) and the run is
 * marked complete/failed (`analysis_status`).
 *
 * The overview doesn't have a real dropped_count, so the caption describes
 * the contract and only shows the number we can actually derive: the count
 * of verified findings that were posted (`totalFindings`). Nothing invented.
 */
export function SynthesizerHourglass({ totalFindings, hasReviews }: SynthesizerHourglassProps) {
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const animated = hasReviews && !reducedMotion;

  const caption = hasReviews
    ? `Merges agent findings, verifies each against the diff, drops what it can't prove — ${totalFindings} verified finding${totalFindings === 1 ? "" : "s"} posted.`
    : "Idle — when a review runs, every agent's findings pass through here before anything posts.";

  return (
    <div className="glass-panel flex h-full flex-col p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Synthesizer — how findings are verified before posting"
        className="flex flex-1 cursor-pointer flex-col items-center gap-3 rounded-xl text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50"
      >
        <div className="flex items-center gap-2 pt-1">
          <span className="text-sm font-semibold text-content-primary">Synthesizer</span>
          <IconChevronDown
            size={14}
            stroke={2}
            className={`text-content-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </div>
        <span className="text-[11px] font-medium uppercase tracking-wider text-content-muted">
          Project manager · Opus
        </span>

        {/* Hourglass: top bulb = incoming findings, neck = verification,
            bottom bulb = verified findings posted. */}
        <svg
          viewBox="0 0 120 160"
          className="my-1 w-24"
          role="img"
          aria-label="Hourglass: agent findings enter the top, are verified at the neck, and only verified findings reach the bottom to post"
        >
          {/* Frame caps */}
          <line x1={30} y1={16} x2={90} y2={16} stroke="var(--color-accent-primary)" strokeOpacity={hasReviews ? 0.9 : 0.35} strokeWidth={2.5} strokeLinecap="round" />
          <line x1={30} y1={144} x2={90} y2={144} stroke="var(--color-accent-primary)" strokeOpacity={hasReviews ? 0.9 : 0.35} strokeWidth={2.5} strokeLinecap="round" />
          {/* Glass outline */}
          <path
            d="M36 20 C36 48 56 62 56 78 C56 94 36 110 36 140"
            fill="none"
            stroke="var(--color-accent-primary)"
            strokeOpacity={hasReviews ? 0.7 : 0.3}
            strokeWidth={1.5}
          />
          <path
            d="M84 20 C84 48 64 62 64 78 C64 94 84 110 84 140"
            fill="none"
            stroke="var(--color-accent-primary)"
            strokeOpacity={hasReviews ? 0.7 : 0.3}
            strokeWidth={1.5}
          />
          {/* Sand: top heap (incoming findings) */}
          <path
            d="M48 44 Q60 36 72 44 Q66 54 60 60 Q54 54 48 44 Z"
            fill="var(--color-accent-primary)"
            opacity={hasReviews ? 0.35 : 0.12}
          />
          {/* Sand: bottom heap (verified, posted) */}
          <path
            d="M42 134 Q60 116 78 134 L78 138 L42 138 Z"
            fill="var(--color-accent-success)"
            opacity={hasReviews ? 0.4 : 0.12}
          />
          {/* Falling grains through the verification neck */}
          {animated ? (
            [0, 1, 2].map((i) => (
              <motion.circle
                key={i}
                cx={60}
                r={1.75}
                fill="var(--color-accent-info)"
                initial={{ cy: 66, opacity: 0 }}
                animate={{ cy: [66, 124], opacity: [0, 1, 1, 0] }}
                transition={{
                  duration: 1.6,
                  delay: i * 0.55,
                  repeat: Infinity,
                  ease: "easeIn",
                  opacity: { duration: 1.6, delay: i * 0.55, repeat: Infinity, times: [0, 0.2, 0.8, 1], ease: "linear" },
                }}
              />
            ))
          ) : (
            <circle cx={60} cy={90} r={1.75} fill="var(--color-accent-info)" opacity={hasReviews ? 0.8 : 0.25} />
          )}
        </svg>

        <p className="text-xs leading-relaxed text-content-muted">{caption}</p>
      </button>

      {/* The verify-and-drop contract, in plain terms — mirrors the real
          SynthesizerAgent pipeline, no fabricated metrics. */}
      {expanded && (
        <motion.ol
          initial={reducedMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-3 space-y-2 overflow-hidden border-t border-border-subtle pt-3"
        >
          {[
            ["Merge", "Collects every specialist agent's findings for the pull request."],
            ["Verify", "Checks each finding against the actual diff — can it be proven?"],
            ["Drop", "Discards low-confidence or hallucinated findings (tracked as dropped_count)."],
            ["Post", "Posts the survivors as PR comments and marks the run complete or failed."],
          ].map(([step, detail], i) => (
            <li key={step} className="flex items-start gap-2.5 text-left">
              <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-accent-primary/15 font-mono text-[10px] font-semibold text-accent-primary">
                {i + 1}
              </span>
              <p className="text-xs leading-relaxed text-content-muted">
                <span className="font-medium text-content-secondary">{step}.</span> {detail}
              </p>
            </li>
          ))}
        </motion.ol>
      )}
    </div>
  );
}
