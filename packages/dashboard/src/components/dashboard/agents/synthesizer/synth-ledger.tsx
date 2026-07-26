"use client";

import type { ReactNode } from "react";
import { IconCheck, IconFlag, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Right pane of the Synthesizer console (spec §3, §4): the verdict ledger +
 * the human gate. Counters (verified / dropped / needs-attention) climb from
 * the stream. When `ready`, the approval card is raised — the gate action is a
 * disabled shell until the backend gate is wired (matching pr-panel honesty).
 * `gateLabel` differs per door: "Approve solution" (Agents) vs "Post PR"
 * (Services summary).
 */
export function SynthLedger({
  kept,
  dropped,
  needsAttention,
  ready,
  gateLabel,
  gateHint,
}: {
  kept: number;
  dropped: number;
  needsAttention: number;
  ready: boolean;
  gateLabel: string;
  gateHint: string;
}) {
  return (
    <aside className="hidden shrink-0 flex-col gap-3 border-l border-border-subtle p-3 lg:flex lg:w-[196px]">
      <div className="grid grid-cols-3 gap-1.5">
        <Counter label="Verified" value={kept} tone="success" icon={<IconCheck size={12} stroke={2.5} />} />
        <Counter label="Dropped" value={dropped} tone="muted" icon={<IconX size={12} stroke={2.5} />} />
        <Counter label="Flagged" value={needsAttention} tone="attention" icon={<IconFlag size={12} stroke={2.5} />} />
      </div>

      {needsAttention > 0 && (
        <p className="rounded-lg border border-accent-warning/25 bg-accent-warning/[0.06] px-2.5 py-2 text-[11px] leading-4 text-accent-warning">
          {needsAttention} {needsAttention === 1 ? "finding wants" : "findings want"} your eyes before this ships.
        </p>
      )}

      {ready && (
        <div className="mt-auto space-y-2 rounded-xl border border-accent-primary/25 bg-accent-primary/[0.06] p-3">
          <p className="text-[11px] font-semibold text-content-primary">Ready for your approval</p>
          <p className="text-[11px] leading-4 text-content-muted">
            {kept} verified {kept === 1 ? "finding" : "findings"} composed into the review.
          </p>
          <Button
            size="sm"
            disabled
            title="Backend gate coming soon"
            className="h-8 w-full rounded-lg text-[12px]"
          >
            <IconCheck size={13} stroke={2} aria-hidden />
            {gateLabel}
          </Button>
          <p className="text-[10px] leading-4 text-content-muted/80">{gateHint}</p>
        </div>
      )}
    </aside>
  );
}

function Counter({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "success" | "muted" | "attention";
  icon: ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "text-accent-success"
      : tone === "attention"
        ? "text-accent-warning"
        : "text-content-muted";
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-1/40 px-1 py-2">
      <span className={cn("flex items-center gap-1 tabular-nums text-base font-semibold", toneClass)}>
        {value}
      </span>
      <span className="flex items-center gap-0.5 font-mono text-[9px] uppercase tracking-wider text-content-muted">
        <span className={toneClass} aria-hidden>
          {icon}
        </span>
        {label}
      </span>
    </div>
  );
}
