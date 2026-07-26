"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2 } from "@tabler/icons-react";
import type { InboxView, WorkItemView } from "@/lib/work-items";

// ── Work-item inbox (rail) ───────────────────────────────────────────────────

/**
 * The rail's work-item mailbox: what Kuma discovered in the connected repos,
 * plus the honest scan-status line and the manual re-scan control.
 *
 * `KIND_LABEL`/`KIND_CHIP` are exported because `work-item-panel.tsx` renders
 * the SAME chip for the selected item's header — one map, so the rail row and
 * the detail panel can never disagree about what an item's kind is called or
 * coloured. The dependency runs panel → inbox (never the reverse), so the
 * services import graph stays acyclic.
 */
export const KIND_LABEL: Record<WorkItemView["kind"], string> = {
  issue: "Issue",
  opportunity: "Opportunity",
  error: "Error",
  pr_finding: "PR finding",
};
export const KIND_CHIP: Record<WorkItemView["kind"], string> = {
  issue: "text-accent-danger border-accent-danger/30 bg-accent-danger/10",
  error: "text-accent-danger border-accent-danger/30 bg-accent-danger/10",
  opportunity: "text-accent-success border-accent-success/30 bg-accent-success/10",
  pr_finding: "text-accent-info border-accent-info/30 bg-accent-info/10",
};

/**
 * Identity of the scan run currently on screen.
 *
 * `lastScan` carries no id, so a run is identified by (status, finishedAt).
 * This exists because clicking Scan almost always happens while an OLDER
 * completed run is displayed: without comparing identity, "status is no longer
 * running" is already true on arrival and the spinner would stop instantly,
 * reporting a previous scan's completion as this one's. Exported for tests.
 */
export function scanIdentity(lastScan: InboxView["lastScan"]): string {
  return `${lastScan?.status ?? "none"}|${lastScan?.finishedAt ?? ""}`;
}

/** The honest scan-status line: real ScanRun status only, never invented. */
function scanStatusLine(lastScan: InboxView["lastScan"]): string {
  if (!lastScan) return "Not scanned yet.";
  if (lastScan.status === "running") return "Scanning…";
  if (lastScan.status === "failed") return `Scan failed: ${lastScan.error ?? "unknown error"} — retry`;
  const when = lastScan.finishedAt ? new Date(lastScan.finishedAt).toLocaleDateString() : "";
  if (lastScan.status === "no_findings") return `Scanned ${when} — no issues found. Rescan anytime.`;
  return `Scanned ${when}.`;
}

export function WorkItemInboxSection({
  inbox,
  activeItemId,
  onSelect,
}: {
  inbox: InboxView;
  activeItemId: string | null;
  onSelect: (item: WorkItemView) => void;
}) {
  const router = useRouter();
  const [scanRequested, setScanRequested] = useState(false);
  const [stalled, setStalled] = useState(false);
  const openIssues = inbox.items.filter((i) => i.state === "open" && i.kind !== "opportunity").length;
  const openOpportunities = inbox.items.filter((i) => i.state === "open" && i.kind === "opportunity").length;
  const running = inbox.lastScan?.status === "running";
  const scanning = scanRequested || running;

  async function handleScan() {
    scanKeyAtRequest.current = scanKey;
    setScanRequested(true);
    setStalled(false);
    try {
      // 202 started / 409 already running — both mean a run is (now) live.
      // Anything else is a refusal and resets the control.
      const res = await fetch("/api/scan", { method: "POST" });
      if (res.status !== 202 && res.status !== 409) {
        setScanRequested(false);
      }
    } catch {
      setScanRequested(false);
    }
  }

  // Watch the REAL ScanRun row until it stops running.
  //
  // This replaced `setTimeout(() => window.location.reload(), 1500)`, which was
  // a lie in both directions: a scan slower than 1.5s came back still showing
  // "Scanning…" with no further updates, and the reload fired whether or not
  // anything had actually happened. The status line below renders the row's own
  // status, so refreshing until the row leaves `running` makes the spinner mean
  // exactly what it says.
  //
  // Bounded on purpose. If the run is still `running` after MAX_POLLS, we stop
  // and SAY so rather than spinning forever against a stuck or crashed worker —
  // an honest "still running" beats an animation that implies progress.
  // An INTERVAL, not a self-re-arming timeout, and the dependency list is
  // deliberately just [scanning, router].
  //
  // The first version used setTimeout with `lastScan.status`/`finishedAt` in the
  // deps, intending each refresh to re-run the effect and arm the next tick.
  // That only works while the data keeps CHANGING. A scan sitting in steady
  // `running` returns an identical status and finishedAt every time, so the deps
  // never changed, the effect never re-ran, and polling stopped dead after
  // exactly one tick — leaving the spinner up indefinitely and never reaching
  // MAX_POLLS, which is the precise failure this block exists to prevent.
  // An interval is armed once when scanning starts and cleared when it stops, so
  // it cannot depend on the data it is waiting for.
  const polls = useRef(0);
  useEffect(() => {
    // `stalled` also stops the loop: once we have given up, a server still
    // reporting `running` would otherwise keep `scanning` true and leave the
    // interval ticking forever, doing nothing on every tick.
    if (!scanning || stalled) {
      polls.current = 0;
      return;
    }
    const POLL_MS = 2000;
    const MAX_POLLS = 45; // ~90s, then we stop claiming to know.
    const timer = setInterval(() => {
      if (polls.current >= MAX_POLLS) {
        setStalled(true);
        setScanRequested(false);
        return;
      }
      polls.current += 1;
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [scanning, stalled, router]);

  // Retiring the local "I asked for a scan" flag needs care, because `lastScan`
  // usually already holds an OLDER completed run at the moment you click. Just
  // checking `status !== "running"` would clear the flag on that stale row and
  // stop the spinner immediately, reporting a completion that belongs to a
  // previous scan. `lastScan` carries no id, so identity is (status, finishedAt)
  // — the flag drops only once that pair actually CHANGES from what was on
  // screen when the scan was requested.
  const scanKey = scanIdentity(inbox.lastScan);
  const scanKeyAtRequest = useRef(scanKey);
  useEffect(() => {
    if (scanKey !== scanKeyAtRequest.current) setScanRequested(false);
  }, [scanKey]);

  return (
    <div className="border-b border-border-subtle">
      <header className="flex items-center gap-2 px-3 pb-1 pt-3">
        <div className="min-w-0">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">Work items</h3>
          <p className="mt-0.5 whitespace-nowrap font-mono text-[10px] tabular-nums text-content-muted">
            Issues ({openIssues}) · Opportunities ({openOpportunities})
          </p>
        </div>
      </header>

      {inbox.items.length > 0 && (
        <ul className="py-1">
          {inbox.items.map((it) => {
            const on = it.id === activeItemId;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onSelect(it)}
                  aria-current={on ? "true" : undefined}
                  className={`flex w-full items-center gap-2 py-1.5 pl-3 pr-3 text-left transition-colors ${
                    on
                      ? "bg-accent-primary/[0.1] text-content-primary"
                      : "text-content-secondary hover:bg-content-primary/[0.04]"
                  }`}
                >
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold ${KIND_CHIP[it.kind]}`}
                  >
                    {KIND_LABEL[it.kind]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{it.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-content-muted">{it.dimension}</span>
                  <span
                    className="shrink-0 font-mono text-[10px] tabular-nums text-content-muted"
                    title="Verified confidence from the scanning agents"
                  >
                    {Math.round(it.confidence * 100)}%
                  </span>
                  {it.state !== "open" && (
                    <span className="shrink-0 rounded-full border border-border-default bg-surface-2 px-1.5 py-px font-mono text-[9px] text-content-muted">
                      {it.state}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Honest status line + manual re-scan. A scanned-clean repo is
          connected_idle: populated ("no issues found"), never blank. */}
      <div className="flex items-center gap-2 px-3 pb-3 pt-1">
        <p
          className={`min-w-0 flex-1 text-[10.5px] leading-4 ${
            stalled ? "text-accent-warning" : "text-content-muted"
          }`}
        >
          {stalled
            ? "Still running after 90s — Kuma stopped watching. Scan again to re-check."
            : scanning
              ? "Scanning…"
              : scanStatusLine(inbox.lastScan)}
        </p>
        <button
          type="button"
          onClick={handleScan}
          disabled={scanning}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-default bg-surface-2 px-2 py-1 text-[10.5px] font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {scanning ? (
            <IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden />
          ) : null}
          Scan
        </button>
      </div>
    </div>
  );
}
