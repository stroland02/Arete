"use client";

/**
 * GlassBoxDock — the live dogfooding cockpit surface.
 * Design: docs/superpowers/specs/2026-07-15-glass-box-cockpit-design.md §4–§5.
 *
 * A small, collapsible floating panel mounted in the authenticated dashboard
 * layout. It does two things:
 *  1. NARRATOR: renders the Synthesizer's live narration of background events
 *     (git commits, queue jobs, …) as they stream from the sidecar over SSE.
 *  2. LIVE MONITOR: when work lands (a git.* event), it calls router.refresh()
 *     so the current page's Server Components (/overview metrics + Sensorium)
 *     re-run against fresh data WITHOUT a full reload or losing client state.
 *     Debounced so a rebase storm triggers one refresh, not many.
 *
 * Dev-only by default: it renders nothing unless a Glass Box SSE URL is
 * configured (NEXT_PUBLIC_GLASSBOX_URL), so it is inert in any environment
 * where the sidecar isn't running. Honest offline state; never fabricated.
 *
 * Additive + presentational: no new dependencies, no server route, no Redis.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGlassBoxStream } from "./use-glassbox-stream";

// Empty by default → the dock is INERT (renders null) unless a dev explicitly
// sets NEXT_PUBLIC_GLASSBOX_URL. So production, where the sidecar never runs,
// never even mounts the feed. Local dev sets it in .env.local.
const GLASSBOX_URL = process.env.NEXT_PUBLIC_GLASSBOX_URL ?? "";
const REFRESH_DEBOUNCE_MS = 2000;

const toneClass: Record<string, string> = {
  success: "text-accent-success",
  error: "text-accent-danger",
  warn: "text-amber-500",
  info: "text-content-secondary",
};

export function GlassBoxDock({ url = GLASSBOX_URL }: { url?: string }) {
  const router = useRouter();
  const { items, connected, hello, landingTick } = useGlassBoxStream(url || null);
  const [open, setOpen] = useState(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHandledTick = useRef(0);

  // Live monitor: debounce-refresh the current route when work lands.
  useEffect(() => {
    if (landingTick === 0 || landingTick === lastHandledTick.current) return;
    lastHandledTick.current = landingTick;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [landingTick, router]);

  // Inert unless explicitly wired (dev cockpit only).
  if (!url) return null;

  return (
    // The fixed wrapper spans a large corner region but is mostly empty. Left
    // interactive, its transparent extents (and the tall overflow list) sit on
    // top of page controls like the /agents composer Send button and silently
    // swallow clicks. `pointer-events-none` makes the whole fixed layer
    // click-through; only the visible panel below re-enables `pointer-events-auto`.
    // So elementFromPoint over any empty extent returns the page control beneath,
    // not the dock. (QA bug 1, 2026-07-15.)
    <div
      data-testid="glassbox-dock"
      className="pointer-events-none fixed bottom-4 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)]"
    >
      {/* Panel stays click-through (inherits pointer-events-none) so it never
          swallows clicks on page controls it visually overlaps; only the header
          toggle re-enables pointer events — it's a small target at the top of
          the dock, clear of bottom-anchored page controls. The feed items below
          are non-interactive, so nothing is lost by leaving them click-through. */}
      <div className="overflow-hidden rounded-2xl border border-border-default bg-surface-1/95 shadow-xl backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="pointer-events-auto flex w-full items-center justify-between gap-2 border-b border-border-subtle px-4 py-2.5 text-left"
        >
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-accent-success" : "bg-content-muted/50"}`}
              aria-hidden
            />
            <span className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
              Glass Box
            </span>
          </span>
          <span className="font-mono text-[10px] text-content-muted">
            {connected ? "live" : "offline"} · {open ? "hide" : "show"}
          </span>
        </button>

        {open && (
          <>
            {/* Provenance banner — which checkout/sha is actually being served.
                Makes the stale-worktree footgun visible instead of latent. */}
            {hello?.refs && (
              <p className="border-b border-border-subtle px-4 py-1.5 font-mono text-[10px] text-content-muted">
                serving {hello.refs.branch ?? "?"}
                {hello.refs.sha ? ` @ ${hello.refs.sha.slice(0, 7)}` : ""}
              </p>
            )}

            <ol className="max-h-[40vh] space-y-1.5 overflow-y-auto px-4 py-3">
              {items.length === 0 ? (
                <li className="text-xs text-content-muted">
                  {connected
                    ? "Watching for work as it lands…"
                    : "Live monitor offline — start it with `pnpm dev:glassbox`."}
                </li>
              ) : (
                items
                  .slice()
                  .reverse()
                  .map((it) => (
                    <li key={it.id} className="text-xs leading-5">
                      <span className={`${toneClass[it.tone] ?? toneClass.info}`}>{it.text}</span>
                    </li>
                  ))
              )}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
