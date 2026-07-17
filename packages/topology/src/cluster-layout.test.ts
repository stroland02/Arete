import { describe, it, expect } from "vitest";
import type { Topology } from "./topology.js";
import {
  layoutClusters,
  folderOfPath,
  buildOwnerMap,
  buildFileAdjacency,
  CHIP_W,
  CHIP_H,
  REGION_PAD,
  REGION_HEADER_H,
} from "./cluster-layout.js";

/** Small graph: 2 folders + a repo-root file; functions fold into files. */
const t: Topology = {
  nodes: [
    { id: "fA", kind: "File", label: "a.ts", provider: "code", meta: { path: "src/auth/a.ts" } },
    { id: "fB", kind: "File", label: "b.ts", provider: "code", meta: { path: "src/auth/b.ts" } },
    { id: "fC", kind: "File", label: "c.ts", provider: "code", meta: { path: "src/billing/c.ts" } },
    { id: "fR", kind: "File", label: "root.ts", provider: "code", meta: { path: "root.ts" } },
    // A function inside a.ts — must NOT get its own chip; folds into fA.
    { id: "fnA", kind: "Function", label: "doA", provider: "code", meta: { path: "src/auth/a.ts" } },
  ],
  edges: [
    // containment: never an adjacency/folder edge
    { id: "e0", from: "fA", to: "fnA", kind: "CONTAINS", source: "code" },
    // function-level call: rolls up to file fA -> fC and folder src/auth -> src/billing
    { id: "e1", from: "fnA", to: "fC", kind: "CALLS", source: "code" },
    // intra-folder file edge: in adjacency, NOT in folderEdges
    { id: "e2", from: "fA", to: "fB", kind: "CALLS", source: "code" },
    // second cross-folder edge same direction: folder edge count aggregates to 2
    { id: "e3", from: "fB", to: "fC", kind: "CALLS", source: "code" },
  ],
  groups: [],
};

describe("folderOfPath", () => {
  it("returns the immediate parent directory", () => {
    expect(folderOfPath("src/auth/a.ts")).toBe("src/auth");
  });
  it("groups repo-root files under '/'", () => {
    expect(folderOfPath("root.ts")).toBe("/");
  });
});

describe("buildOwnerMap", () => {
  it("maps a File to itself and a function to its path-matched File", () => {
    const owner = buildOwnerMap(t);
    expect(owner.get("fA")).toBe("fA");
    expect(owner.get("fnA")).toBe("fA");
  });
});

describe("buildFileAdjacency", () => {
  it("rolls function edges up to owning files, skips CONTAINS, dedupes", () => {
    const adj = buildFileAdjacency(t);
    expect(adj.get("fA")!.imports.sort()).toEqual(["fB", "fC"]); // e1 via fnA, e2
    expect(adj.get("fC")!.importedBy.sort()).toEqual(["fA", "fB"]);
    expect(adj.get("fB")!.importedBy).toEqual(["fA"]);
  });
});

describe("layoutClusters", () => {
  const layout = layoutClusters(t);

  it("creates one region per folder with sorted file chips (no function chips)", () => {
    const folders = layout.regions.map((r) => r.folder).sort();
    expect(folders).toEqual(["/", "src/auth", "src/billing"]);
    const auth = layout.regions.find((r) => r.folder === "src/auth")!;
    expect(auth.fileIds).toEqual(["fA", "fB"]); // label-sorted
    expect(layout.chips.has("fnA")).toBe(false);
  });

  it("places every chip inside its region", () => {
    for (const r of layout.regions) {
      for (const id of r.fileIds) {
        const c = layout.chips.get(id)!;
        expect(c.x).toBeGreaterThanOrEqual(r.x + REGION_PAD);
        expect(c.x + CHIP_W).toBeLessThanOrEqual(r.x + r.w - REGION_PAD + 1);
        expect(c.y).toBeGreaterThanOrEqual(r.y + REGION_HEADER_H);
        expect(c.y + CHIP_H).toBeLessThanOrEqual(r.y + r.h + 1);
      }
    }
  });

  it("aggregates cross-folder edges with counts and drops intra-folder ones", () => {
    expect(layout.folderEdges).toEqual([
      { from: "src/auth", to: "src/billing", count: 2 },
    ]);
  });

  it("is deterministic and never overlaps regions", () => {
    const again = layoutClusters(t);
    expect(again.regions).toEqual(layout.regions);
    for (const a of layout.regions)
      for (const b of layout.regions) {
        if (a === b) continue;
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
  });

  it("wraps regions at maxWidth and extends the extent", () => {
    const narrow = layoutClusters(t, { maxWidth: 300 });
    expect(narrow.extent.h).toBeGreaterThan(layout.extent.h);
  });

  it("handles an empty topology without NaN/Infinity", () => {
    const empty = layoutClusters({ nodes: [], edges: [], groups: [] });
    expect(empty.regions).toEqual([]);
    expect(Number.isFinite(empty.extent.w)).toBe(true);
    expect(Number.isFinite(empty.extent.h)).toBe(true);
  });
});
