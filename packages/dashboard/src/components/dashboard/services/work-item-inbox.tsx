"use client";

import { useState } from "react";
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
  const [scanRequested, setScanRequested] = useState(false);
  const openIssues = inbox.items.filter((i) => i.state === "open" && i.kind !== "opportunity").length;
  const openOpportunities = inbox.items.filter((i) => i.state === "open" && i.kind === "opportunity").length;
  const scanning = scanRequested || inbox.lastScan?.status === "running";

  async function handleScan() {
    setScanRequested(true);
    try {
      // 202 started / 409 already running — both mean a run is (now) live, so
      // refresh shortly to pick up its ScanRun row. Anything else resets.
      const res = await fetch("/api/scan", { method: "POST" });
      if (res.status === 202 || res.status === 409) {
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setScanRequested(false);
      }
    } catch {
      setScanRequested(false);
    }
  }

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
        <p className="min-w-0 flex-1 text-[10.5px] leading-4 text-content-muted">
          {scanRequested ? "Scanning…" : scanStatusLine(inbox.lastScan)}
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
