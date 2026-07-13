"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { IconArrowRight, IconHourglassHigh } from "@tabler/icons-react";
import { staggerContainer, fadeSlideUp } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SynthesizerConsoleProps {
  hasReviews: boolean;
  totalFindings: number;
  /** Label of the agent selected in the rail — the narration focuses on it. */
  selectedAgentLabel: string;
  /** Real finding count for the selected agent (from commentsByCategory). */
  selectedAgentFindings: number;
}

type StepTone = "done" | "working" | "success" | "muted";

interface Step {
  marker: string;
  tone: StepTone;
  text: string;
  detail?: string;
}

const TONE_CLASS: Record<StepTone, string> = {
  done: "text-accent-primary",
  working: "text-accent-info",
  success: "text-accent-success",
  muted: "text-content-muted",
};

/**
 * Center pane of the /agents workspace: an Orca-style console transcript of
 * the Synthesizer's review workflow, plus a pinned input strip.
 *
 * HONESTY: this is a UI shell. The transcript is a clearly-labeled scripted
 * replay ("Preview" chip + caption) whose numbers come only from real review
 * data (per-agent finding counts, verified total) — nothing invents counts,
 * and nothing implies a live model is answering. The input bar is disabled
 * until the real ChatAgent is wired up (explicit follow-up in the spec).
 */
export function SynthesizerConsole({
  hasReviews,
  totalFindings,
  selectedAgentLabel,
  selectedAgentFindings,
}: SynthesizerConsoleProps) {
  const steps: Step[] = hasReviews
    ? [
        {
          marker: "●",
          tone: "done",
          text: "Review started — 6 specialists dispatched in parallel",
          detail: "security · performance · quality · tests · deploys · business logic",
        },
        {
          marker: "●",
          tone: "done",
          text: `${selectedAgentLabel} reported ${selectedAgentFindings} finding${
            selectedAgentFindings === 1 ? "" : "s"
          }`,
          detail:
            selectedAgentFindings === 0
              ? "nothing to flag in its lane — that's a real result too"
              : "candidate findings handed to the Synthesizer",
        },
        {
          marker: "◈",
          tone: "working",
          text: "Independent Critic re-checked every finding",
          detail:
            "a separate model verifies each finding against the diff — anything not backed by real evidence in the code is dropped",
        },
        {
          marker: "✓",
          tone: "success",
          text: `${totalFindings} evidence-backed finding${
            totalFindings === 1 ? "" : "s"
          } posted to the PR`,
        },
      ]
    : [];

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Synthesizer console">
      {/* Pane header */}
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            hasReviews
              ? "bg-accent-success shadow-[0_0_6px_rgba(52,211,153,0.8)]"
              : "bg-content-muted/40"
          )}
          aria-hidden
        />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
          Synthesizer
        </h2>
        <span className="rounded-full border border-accent-info/25 bg-accent-info/10 px-1.5 py-px text-[10px] font-medium text-accent-info">
          Preview
        </span>
        <span className="ml-auto truncate text-[11px] text-content-muted">
          focused on {selectedAgentLabel}
        </span>
      </header>

      {/* Transcript */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {hasReviews ? (
          <motion.ol
            className="space-y-0.5 font-mono text-xs"
            variants={staggerContainer}
            initial="hidden"
            animate="show"
          >
            <li className="pb-2 text-[10px] uppercase tracking-wider text-content-muted">
              Scripted replay of your last review workflow — not a live model
            </li>
            {steps.map((step) => (
              <motion.li key={step.text} variants={fadeSlideUp} className="rounded-md px-2 py-1.5 hover:bg-content-primary/[0.03]">
                <div className="flex items-start gap-2.5">
                  <span className={cn("shrink-0 leading-4", TONE_CLASS[step.tone])} aria-hidden>
                    {step.marker}
                  </span>
                  <div className="min-w-0">
                    <p className="text-content-secondary">{step.text}</p>
                    {step.detail && (
                      <p className="mt-0.5 text-[11px] leading-4 text-content-muted">
                        {step.detail}
                      </p>
                    )}
                  </div>
                </div>
              </motion.li>
            ))}
          </motion.ol>
        ) : (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
            <div className="rounded-2xl border border-border-default bg-content-primary/5 p-3 text-accent-primary">
              <IconHourglassHigh size={24} stroke={1.5} />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-content-primary">
                The Synthesizer coordinates every review
              </p>
              <p className="text-xs leading-5 text-content-muted">
                It gathers findings from all six specialist agents, then an
                independent Critic — a separate model — verifies each one against
                your diff and drops anything not backed by real evidence. Only the
                proven findings reach your pull request — so you see signal, not noise.
              </p>
            </div>

            <ol className="w-full space-y-2 text-left">
              {[
                "Connect a repository",
                "Open a pull request",
                "Areté reviews it automatically — the workflow streams here",
              ].map((step, i) => (
                <li key={step} className="flex items-start gap-2.5">
                  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-default bg-content-primary/5 font-mono text-[10px] text-content-secondary">
                    {i + 1}
                  </span>
                  <span className="text-xs leading-5 text-content-secondary">{step}</span>
                </li>
              ))}
            </ol>

            <Link
              href="/connections"
              className="inline-flex items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/30"
            >
              Connect a repository
              <IconArrowRight size={15} stroke={2} />
            </Link>
          </div>
        )}
      </div>

      {/* Pinned input strip — deliberately disabled: no live model yet. */}
      <footer className="shrink-0 border-t border-border-subtle px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-2/60 px-3 py-2">
          <span className="font-mono text-xs text-content-muted" aria-hidden>
            &gt;
          </span>
          <input
            type="text"
            disabled
            placeholder="Ask the Synthesizer…"
            aria-label="Ask the Synthesizer (live chat coming soon)"
            title="Live chat coming soon"
            className="w-full cursor-not-allowed bg-transparent font-mono text-xs text-content-primary placeholder:text-content-muted/70 focus:outline-none"
          />
        </div>
        <p className="mt-1.5 px-1 font-mono text-[10px] text-content-muted/80">
          preview shell · live chat coming soon · select an agent to focus its steps
        </p>
      </footer>
    </section>
  );
}
