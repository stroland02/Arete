"use client";

import { projectStatusBoard, type BoardRow } from "@/lib/issue-pipeline/status-board";
import type { SynthStep } from "@/lib/issue-pipeline/types";
import { useSynthStream } from "../agents/synthesizer/use-synth-stream";

/**
 * Situational-awareness board (tiered comms §4) for the Services Synth panel:
 * one row per specialist over the live SynthStep stream — status, confidence, and
 * whether it has escalated. Pure over `steps`; renders NOTHING until a specialist
 * has actually reported (honest empty, no skeleton rows, no fabricated status).
 */
export function StatusBoard({ steps }: { steps: SynthStep[] }) {
  const rows = projectStatusBoard(steps);
  if (rows.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-border-subtle px-3 py-2.5" aria-label="Specialist status board">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-content-muted">Specialists</p>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <BoardRowView key={row.agentId} row={row} />
        ))}
      </div>
    </div>
  );
}

function statusPillClass(status: BoardRow["status"]): string {
  switch (status) {
    case "on_track":
    case "done":
      return "border-accent-success/30 bg-accent-success/10 text-accent-success";
    case "blocked":
    case "needs_input":
      return "border-accent-warning/30 bg-accent-warning/10 text-accent-warning";
    case "escalating":
      return "border-accent-danger/30 bg-accent-danger/10 text-accent-danger";
  }
}

function BoardRowView({ row }: { row: BoardRow }) {
  const pct = Math.round(row.confidence * 100);
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-2/40 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-content-secondary">{row.dimension}</span>
        <span className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${statusPillClass(row.status)}`}>
          {row.status.replace("_", " ")}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-content-muted">{pct}%</span>
        {row.escalatedTo !== "none" && (
          <span className="shrink-0 font-mono text-[10px] font-semibold text-accent-warning">↑ {row.escalatedTo}</span>
        )}
      </div>
      {row.topBlocker && (
        <p className="text-[10px] leading-4 text-accent-warning/90">{row.topBlocker}</p>
      )}
    </div>
  );
}

/**
 * Live wrapper: rides the SAME SSE stream the console consumes (the endpoint is
 * idempotent, so the board sees the identical steps) and projects the board above
 * it. Null containerId → no stream, board renders nothing.
 */
export function StatusBoardLive({ containerId }: { containerId: string | null }) {
  const view = useSynthStream(containerId);
  return <StatusBoard steps={view.steps} />;
}
