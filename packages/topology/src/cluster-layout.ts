// ---------------------------------------------------------------------------
// Folder-cluster layout for the code map (Sensorium v2): File nodes grouped
// into rounded folder regions, function/child nodes folded into their owning
// file, cross-folder edges aggregated with counts. Pure + deterministic, in
// the same dependency-free spirit as layout.ts. Spec:
// docs/superpowers/specs/2026-07-17-code-map-v2-design.md
// ---------------------------------------------------------------------------

import type { Topology, TopologyNode } from "./topology.js";

export const CHIP_W = 180;
export const CHIP_H = 44;
export const REGION_HEADER_H = 40;
export const REGION_PAD = 16;
const CHIP_GAP = 10;
const REGION_GAP = 28;

export type ClusterLayoutOptions = {
  padLeft?: number;
  padTop?: number;
  /** Wrap folder regions to this pixel width (row-flow). */
  maxWidth?: number;
};

export type FolderRegion = {
  /** Immediate parent directory ("src/auth"); "/" for repo-root files. */
  folder: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Member File node ids, label-sorted. */
  fileIds: string[];
};

export type FolderEdge = { from: string; to: string; count: number };

export type ClusterLayout = {
  regions: FolderRegion[];
  /** Absolute top-left of each file chip, keyed by File node id. */
  chips: Map<string, { x: number; y: number }>;
  /** Aggregated cross-folder edges (containment kinds excluded). */
  folderEdges: FolderEdge[];
  /** File-level dependency adjacency (cross-file, containment excluded). */
  adjacency: Map<string, { imports: string[]; importedBy: string[] }>;
  /** Owning folder of each laid-out File node id. */
  folderOf: Map<string, string>;
  extent: { w: number; h: number };
};

/** Immediate parent directory of a path; "/" for repo-root files. */
export function folderOfPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "/" : path.slice(0, i);
}

/**
 * node id -> owning File node id. A File owns itself; any other node folds
 * into the File sharing its meta.path. Nodes with no path-matched File are
 * absent (they neither render nor contribute adjacency).
 */
export function buildOwnerMap(t: Topology): Map<string, string> {
  const fileByPath = new Map<string, string>();
  for (const n of t.nodes) {
    const p = n.meta?.path as string | undefined;
    if (n.kind === "File" && p) fileByPath.set(p, n.id);
  }
  const owner = new Map<string, string>();
  for (const n of t.nodes) {
    if (n.kind === "File") {
      owner.set(n.id, n.id);
      continue;
    }
    const p = n.meta?.path as string | undefined;
    const f = p ? fileByPath.get(p) : undefined;
    if (f) owner.set(n.id, f);
  }
  return owner;
}

// Structural containment, not a dependency — never an adjacency/folder edge.
const CONTAINMENT_KINDS = new Set(["CONTAINS", "DEFINES"]);

/**
 * File-level dependency adjacency: every non-containment edge rolled up to the
 * owning Files of its endpoints; same-file edges dropped; deduped; sorted for
 * determinism. Sidebar "Dependencies" and the map's hover-reveal both read this.
 */
export function buildFileAdjacency(
  t: Topology,
): Map<string, { imports: string[]; importedBy: string[] }> {
  const owner = buildOwnerMap(t);
  const adjacency = new Map<string, { imports: string[]; importedBy: string[] }>();
  for (const n of t.nodes) {
    if (n.kind === "File") adjacency.set(n.id, { imports: [], importedBy: [] });
  }
  for (const e of t.edges) {
    if (CONTAINMENT_KINDS.has(String(e.kind))) continue;
    const a = owner.get(e.from);
    const b = owner.get(e.to);
    if (!a || !b || a === b) continue;
    const adjA = adjacency.get(a);
    const adjB = adjacency.get(b);
    if (adjA && !adjA.imports.includes(b)) adjA.imports.push(b);
    if (adjB && !adjB.importedBy.includes(a)) adjB.importedBy.push(a);
  }
  for (const v of adjacency.values()) {
    v.imports.sort();
    v.importedBy.sort();
  }
  return adjacency;
}

export function layoutClusters(
  t: Topology,
  opts: ClusterLayoutOptions = {},
): ClusterLayout {
  const padLeft = opts.padLeft ?? 32;
  const padTop = opts.padTop ?? 32;
  const maxWidth = opts.maxWidth ?? 1600;

  const files = t.nodes.filter(
    (n) => n.kind === "File" && typeof n.meta?.path === "string",
  );

  // Group files by immediate parent folder.
  const byFolder = new Map<string, TopologyNode[]>();
  for (const f of files) {
    const folder = folderOfPath(f.meta!.path as string);
    (byFolder.get(folder) ?? byFolder.set(folder, []).get(folder)!).push(f);
  }
  const folderOf = new Map<string, string>();
  for (const [folder, fs] of byFolder) for (const f of fs) folderOf.set(f.id, folder);

  // Deterministic region order: most files first, folder name breaks ties.
  const folders = [...byFolder.keys()].sort((a, b) => {
    const d = byFolder.get(b)!.length - byFolder.get(a)!.length;
    return d !== 0 ? d : a.localeCompare(b);
  });

  // Row-flow placement; chips pack in a near-square grid capped at 3 columns.
  const regions: FolderRegion[] = [];
  const chips = new Map<string, { x: number; y: number }>();
  let cursorX = padLeft;
  let cursorY = padTop;
  let rowH = 0;
  for (const folder of folders) {
    const fs = [...byFolder.get(folder)!].sort((a, b) => a.label.localeCompare(b.label));
    const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(fs.length))));
    const rows = Math.ceil(fs.length / cols);
    const w = REGION_PAD * 2 + cols * CHIP_W + (cols - 1) * CHIP_GAP;
    const h = REGION_HEADER_H + rows * CHIP_H + (rows - 1) * CHIP_GAP + REGION_PAD;
    if (cursorX > padLeft && cursorX + w > maxWidth) {
      cursorX = padLeft;
      cursorY += rowH + REGION_GAP;
      rowH = 0;
    }
    const region: FolderRegion = { folder, x: cursorX, y: cursorY, w, h, fileIds: fs.map((f) => f.id) };
    regions.push(region);
    fs.forEach((f, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      chips.set(f.id, {
        x: region.x + REGION_PAD + c * (CHIP_W + CHIP_GAP),
        y: region.y + REGION_HEADER_H + r * (CHIP_H + CHIP_GAP),
      });
    });
    cursorX += w + REGION_GAP;
    rowH = Math.max(rowH, h);
  }

  // Aggregate cross-folder edges (same rollup rules as buildFileAdjacency).
  const adjacency = buildFileAdjacency(t);
  const owner = buildOwnerMap(t);
  const agg = new Map<string, FolderEdge>();
  for (const e of t.edges) {
    if (CONTAINMENT_KINDS.has(String(e.kind))) continue;
    const a = owner.get(e.from);
    const b = owner.get(e.to);
    if (!a || !b || a === b) continue;
    const fa = folderOf.get(a);
    const fb = folderOf.get(b);
    if (!fa || !fb || fa === fb) continue;
    const key = `${fa}→${fb}`;
    const cur = agg.get(key);
    if (cur) cur.count += 1;
    else agg.set(key, { from: fa, to: fb, count: 1 });
  }
  const folderEdges = [...agg.values()].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );

  const extent =
    regions.length === 0
      ? { w: padLeft * 2, h: padTop * 2 }
      : {
          w: Math.max(...regions.map((r) => r.x + r.w)) + padLeft,
          h: Math.max(...regions.map((r) => r.y + r.h)) + padTop,
        };

  return { regions, chips, folderEdges, adjacency, folderOf, extent };
}
