"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { IconArrowRight, IconHourglassHigh } from "@tabler/icons-react";
import { KumaLogo } from "@/components/ui/kuma-logo";
import type { Issue } from "./types";
import { TONE_TEXT, markerForTone } from "./presentation";

/**
 * Center pane: the Synthesizer's verification narrative for the selected
 * issue. Structurally identical to the /agents Synthesizer console (header +
 * scripted transcript + pinned, disabled chat input) — reusing the same
 * shape is deliberate: it's the same Synthesizer, just focused on one issue
 * instead of the whole account, so the verification record for a given
 * issue/PR reads the same on both pages.
 */
export function IssueSynthesizerConsole({ issue, isReplaying, replayStep }: { issue: Issue | null; isReplaying: boolean; replayStep: number }) {
  return (
    <>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span className={`h-1.5 w-1.5 rounded-full ${issue ? "bg-accent-success" : "bg-content-muted/40"}`} aria-hidden />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Synthesizer</h2>
        <span className="rounded-full border border-accent-info/25 bg-accent-info/10 px-1.5 py-px text-[10px] font-medium text-accent-info">Preview</span>
        {issue && <span className="ml-auto truncate text-[11px] text-content-muted">focused on {issue.title}</span>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {issue ? (
          <ol className="space-y-0.5 font-mono text-xs">
            <li className="pb-2 text-[10px] uppercase tracking-wider text-content-muted">
              Scripted replay of this issue&apos;s verification — not a live model
            </li>
            {issue.timeline.map((t, idx) => {
              const status = isReplaying ? (replayStep > idx ? 'done' : replayStep === idx ? 'running' : 'waiting') : 'done';
              if (status === 'waiting') return null;

              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-md px-2 py-1.5 hover:bg-content-primary/[0.03]"
                >
                  <div className="flex items-start gap-2.5">
                    {status === 'running' ? (
                      <motion.div 
                        className="shrink-0 leading-4 text-accent-primary flex items-center justify-center"
                        animate={{ 
                          filter: ["drop-shadow(0 0 2px rgba(0,212,255,0.2))", "drop-shadow(0 0 8px rgba(0,212,255,0.8))", "drop-shadow(0 0 2px rgba(0,212,255,0.2))"]
                        }}
                        transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                      >
                        <KumaLogo size={13} />
                      </motion.div>
                    ) : (
                      <span className={`shrink-0 leading-4 ${TONE_TEXT[t.tone]}`} aria-hidden>{markerForTone(t.tone)}</span>
                    )}
                    <div className="min-w-0">
                      <p className={`text-content-secondary ${status === 'running' ? 'font-medium' : ''}`}>{t.text}</p>
                      <p className="mt-0.5 text-[11px] leading-4 text-content-muted">{t.when}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </ol>
        ) : (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
            <div className="rounded-2xl border border-border-default bg-content-primary/5 p-3 text-accent-primary">
              <IconHourglassHigh size={24} stroke={1.5} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-content-primary">The Synthesizer verifies every issue</p>
              <p className="text-xs leading-5 text-content-muted">
                Pick a service and an issue on the left to see how the Synthesizer verified it — the
                same verification record whether you look at it here or on the Agents page.
              </p>
            </div>

            {/* Same connect CTA as the Agents page, so a fresh account has a
                clear first step from the center pane, not just the rail. */}
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

      {/* Pinned input strip — deliberately disabled: no live model yet, same
          honesty pattern as the /agents Synthesizer console. */}
      <footer className="shrink-0 border-t border-border-subtle px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-2/60 px-3 py-2">
          <span className="font-mono text-xs text-content-muted" aria-hidden>&gt;</span>
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
          preview shell · live chat coming soon{issue ? ` · focused on ${issue.serviceId}` : ""}
        </p>
      </footer>
    </>
  );
}
