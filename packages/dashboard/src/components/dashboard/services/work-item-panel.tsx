"use client";

import { useState } from "react";
import Link from "next/link";
import { IconGitPullRequest, IconHourglassHigh, IconLoader2 } from "@tabler/icons-react";
import type { WorkItemView } from "@/lib/work-items";
import { PanelSection } from "./presentation";
import { KIND_LABEL, KIND_CHIP } from "./work-item-inbox";

/**
 * Right pane for a selected work item: the discovered problem/opportunity with
 * its REAL file:line evidence — exactly what the agents cited, nothing else.
 * Triage v1 is exactly two actions (spec ruling): Fix it (issues/errors) or
 * Implement it (opportunities) → the pipeline; Dismiss → dismissed. Only a
 * human triggers either — nothing here auto-starts or auto-sends.
 * Exported for the state-matrix tests.
 */
export function WorkItemPanel({ item }: { item: WorkItemView }) {
  const [busy, setBusy] = useState<null | 'fix' | 'dismiss'>(null);
  // Fix-run cooldown (Phase 3 Task 8): item.fixCooldown is computed
  // server-side by computeFixCooldown (fix-cooldown.ts) — the SAME pure
  // policy the fix API route enforces. Surfacing it here lets the user see
  // the cooldown BEFORE clicking Fix it, instead of only after a 429.
  const cooldownActive = !item.fixCooldown.allowed;
  const cooldownMinutes = cooldownActive
    ? Math.max(1, Math.ceil((item.fixCooldown.retryAfterSeconds ?? 0) / 60))
    : 0;

  async function act(action: 'fix' | 'dismiss') {
    setBusy(action);
    try {
      const res = await fetch(`/api/work-items/${item.id}/${action}`, { method: 'POST' });
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      // fall through to reset
    }
    setBusy(null);
  }

  return (
    <>
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">Work item</h2>
        <span className={`rounded-full border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide ${KIND_CHIP[item.kind]}`}>
          {KIND_LABEL[item.kind]}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-1 border-b border-border-subtle px-3 py-2.5">
          <p className="text-[12.5px] font-semibold leading-snug text-content-primary">{item.title}</p>
          <p className="font-mono text-[10.5px] text-content-muted">
            {item.dimension} · {Math.round(item.confidence * 100)}% confidence · {item.state}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <PanelSection title="What Kuma found">
            <p className="whitespace-pre-wrap px-1 text-[11.5px] leading-5 text-content-secondary">{item.detail}</p>
          </PanelSection>
          <PanelSection title="Evidence">
            <ul className="mx-1 space-y-1.5">
              {item.evidence.map((ev, idx) => (
                <li key={idx} className="overflow-hidden rounded-lg border border-border-default bg-surface-2">
                  <div className="border-b border-border-subtle px-2.5 py-1.5 font-mono text-[10.5px] text-content-muted">
                    {ev.path}:{ev.line}
                  </div>
                  {ev.excerpt ? (
                    <pre className="overflow-x-auto px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-content-secondary">{ev.excerpt}</pre>
                  ) : null}
                </li>
              ))}
            </ul>
          </PanelSection>
          {item.state === "fixing" && item.containerId ? (
            <PanelSection title="Live fix">
              <p className="px-1 text-[11px] leading-5 text-content-muted">
                Kuma is working this item now — the live stream is playing in the console on the left.{" "}
                <Link
                  href={`/services?container=${encodeURIComponent(item.containerId)}`}
                  className="font-medium text-accent-primary hover:underline"
                >
                  Open the live stream
                </Link>
              </p>
            </PanelSection>
          ) : null}
          {item.state === "posted" ? (
            <PanelSection title="Pull request">
              {item.prUrl ? (
                <a
                  href={item.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mx-1 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-accent-primary hover:underline"
                >
                  <IconGitPullRequest size={13} stroke={2} aria-hidden /> View the posted pull request
                </a>
              ) : (
                <p className="px-1 text-[11px] leading-5 text-content-muted">
                  The pull request has been posted on your repository.
                </p>
              )}
            </PanelSection>
          ) : null}
        </div>

        {/* Triage: only an OPEN item offers actions — everything later is
            driven from the pipeline surfaces (approve on Agents, send on
            Services), keeping one decision per stage. */}
        {item.state === "open" && (
          <footer className="shrink-0 space-y-1.5 border-t border-border-subtle px-3 py-3">
            {cooldownActive && (
              <p
                title="A previous fix attempt failed; retrying immediately would repeat it — the same guard the fix API enforces server-side."
                className="flex items-center gap-1.5 rounded-lg border border-accent-warning/30 bg-accent-warning/10 px-2.5 py-1.5 text-[11px] font-medium text-accent-warning"
              >
                <IconHourglassHigh size={13} stroke={2} aria-hidden />
                retry available in {cooldownMinutes}m
              </p>
            )}
            <button
              type="button"
              onClick={() => act("fix")}
              disabled={busy !== null || cooldownActive}
              title={cooldownActive ? `A previous fix attempt failed — retry available in ${cooldownMinutes}m` : undefined}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "fix" ? (
                <IconLoader2 size={14} stroke={2} className="animate-spin" aria-hidden />
              ) : (
                <IconGitPullRequest size={14} stroke={2} aria-hidden />
              )}
              {item.kind === "opportunity" ? "Implement it" : "Fix it"}
            </button>
            <button
              type="button"
              onClick={() => act("dismiss")}
              disabled={busy !== null}
              className="inline-flex w-full items-center justify-center rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-secondary transition-colors hover:bg-content-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Dismiss
            </button>
            <p className="text-[10px] leading-4 text-content-muted/80">
              Fixing stages one pull request for this item — nothing posts until you approve it.
            </p>
          </footer>
        )}
      </div>
    </>
  );
}
