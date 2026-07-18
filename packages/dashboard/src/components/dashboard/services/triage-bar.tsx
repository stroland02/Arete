"use client";

import { CountUpValue } from "@/components/dashboard/count-up-value";
import type { TriageCounts } from "./triage";

interface Chip { label: string; value: number; dot: string; text: string }

/**
 * The Services "what needs you now?" strip. Three glanceable buckets over the
 * REAL triage counts. Honest: zeros are shown (never hidden to imply activity);
 * an all-clear bar says so plainly rather than vanishing.
 */
export function TriageBar({ counts }: { counts: TriageCounts }) {
  const chips: Chip[] = [
    { label: "Awaiting approval", value: counts.awaiting, dot: "bg-accent-primary", text: "text-accent-primary" },
    { label: "In flight", value: counts.inFlight, dot: "bg-accent-info", text: "text-accent-info" },
    { label: "Blocked", value: counts.blocked, dot: "bg-accent-warning", text: "text-accent-warning" },
  ];
  const allClear = counts.awaiting + counts.inFlight + counts.blocked === 0;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2"
      aria-label="Triage summary"
    >
      <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-content-muted">Triage</span>
      {chips.map((c) => (
        <span
          key={c.label}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-2/60 px-2.5 py-1"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden />
          <span className={`font-mono text-[12px] font-semibold tabular-nums ${c.value === 0 ? "text-content-muted" : c.text}`}>
            <CountUpValue value={String(c.value)} />
          </span>
          <span className="text-[11px] text-content-secondary">{c.label}</span>
        </span>
      ))}
      {allClear && (
        <span className="ml-auto text-[11px] text-content-muted">Nothing waiting on you.</span>
      )}
    </div>
  );
}
