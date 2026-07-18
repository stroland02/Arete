"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import type { DiffRow } from "./services-workspace";
import { diffStat, patchText } from "./diff-stat";

const ROW_BG: Record<DiffRow["kind"], string> = {
  add: "bg-accent-success/10",
  remove: "bg-accent-danger/10",
  context: "",
};
const SIGIL_CLASS: Record<DiffRow["kind"], string> = {
  add: "text-accent-success",
  remove: "text-accent-danger",
  context: "text-content-muted/50",
};

/**
 * A real code-review diff surface: file header + change summary, a muted
 * line-number gutter, tinted add/remove rows, and a copy-patch affordance.
 * Purely presentational over the provided rows — never fabricates content.
 */
export function DiffView({ file, rows }: { file: string; rows: DiffRow[] }) {
  const { added, removed } = diffStat(rows);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(patchText(file, rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — leave the affordance unlatched, no false success */
    }
  }

  // Gutter line numbers advance on context/add (target-side); removes get a blank gutter cell.
  let lineNo = 0;

  return (
    <div className="overflow-hidden rounded-lg border border-border-default bg-surface-2">
      <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-content-muted">{file}</span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-accent-success">+{added}</span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-accent-danger">−{removed}</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy patch"
          className="shrink-0 rounded p-0.5 text-content-muted transition-colors hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
        >
          {copied ? <IconCheck size={13} stroke={2} className="text-accent-success" /> : <IconCopy size={13} stroke={1.75} />}
        </button>
      </div>
      <pre className="overflow-x-auto py-1 font-mono text-[11px] leading-relaxed">
        {rows.map((r, idx) => {
          const n = r.kind === "remove" ? "" : String(++lineNo);
          return (
            <div key={idx} className={`flex gap-2 px-2 ${ROW_BG[r.kind]}`}>
              <span className="w-6 shrink-0 select-none text-right text-content-muted/40 tabular-nums" aria-hidden>{n}</span>
              <span className={`shrink-0 select-none ${SIGIL_CLASS[r.kind]}`} aria-hidden>
                {r.kind === "add" ? "+" : r.kind === "remove" ? "-" : " "}
              </span>
              <span className={r.kind === "context" ? "text-content-muted" : "text-content-secondary"}>{r.text}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
