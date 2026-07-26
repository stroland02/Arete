import type { DiffRow } from "./services-workspace";

export function diffStat(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const r of rows) {
    if (r.kind === "add") added++;
    else if (r.kind === "remove") removed++;
  }
  return { added, removed };
}

const SIGIL: Record<DiffRow["kind"], string> = { add: "+", remove: "-", context: " " };

/** Reconstruct a copyable patch body. Header line names the file. */
export function patchText(file: string, rows: DiffRow[]): string {
  return [`--- ${file}`, ...rows.map((r) => `${SIGIL[r.kind]}${r.text}`)].join("\n");
}
