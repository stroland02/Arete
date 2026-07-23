import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTracker } from "./parse";
import { groupByArea, ideaGroups, readinessTotals } from "./select";
import { AREA_ORDER } from "./schema";

/**
 * Guards the committed seed itself — `packages/dashboard/data/build-tracker.json`.
 *
 * The seed is a hand-authored artifact whose accuracy is the whole point, so it
 * gets the same treatment as code: it must parse, and the 25 migrated inventory
 * rows must reproduce exactly the readiness counts the old static page showed.
 * If a later edit breaks either, this fails before the page ever renders it.
 */

const seedPath = fileURLToPath(new URL("../../../data/build-tracker.json", import.meta.url));
const seed: unknown = JSON.parse(readFileSync(seedPath, "utf8"));

describe("the committed build-tracker seed", () => {
  it("parses cleanly, so every cross-reference and provenance rule holds", () => {
    const result = parseTracker(seed);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  const parsed = parseTracker(seed);

  it("reproduces the pre-migration readiness counts exactly", () => {
    // The counts feature-readiness.ts produced on 2026-07-22: 4 live, 0 preview,
    // 11 partial, 10 soon across 25 audited surfaces. If this drifts, the
    // migration silently altered the product's own status page.
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(readinessTotals(parsed.doc)).toEqual({ live: 4, preview: 0, partial: 11, soon: 10 });
    }
  });

  it("carries exactly 25 inventory rows, matching the original audit", () => {
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.items.filter((i) => i.lane === "inventory")).toHaveLength(25);
    }
  });

  it("catalogues the never-built ideas the sweep recovered", () => {
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // The point of the exercise: a substantial catalogue, not a handful.
      expect(parsed.doc.items.filter((i) => i.lane === "idea").length).toBeGreaterThanOrEqual(40);
    }
  });

  it("groups the inventory into the same four areas, in order", () => {
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const areas = groupByArea(parsed.doc).map((g) => g.area);
      const canonical = AREA_ORDER.filter((a) => areas.includes(a));
      expect(areas).toEqual(canonical);
    }
  });

  it("files every idea into a visible group — none is silently lost", () => {
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const grouped = ideaGroups(parsed.doc).reduce((n, g) => n + g.items.length, 0);
      const ideas = parsed.doc.items.filter((i) => i.lane === "idea" && i.state !== "dropped").length;
      expect(grouped).toBe(ideas);
    }
  });

  it("seeds the four numbering systems without merging them", () => {
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.programmes.map((p) => p.id)).toEqual([
        "product",
        "superlog",
        "observability",
        "orchestration",
      ]);
      // The stale roadmap is marked stale, not quietly presented as current.
      expect(parsed.doc.programmes.find((p) => p.id === "superlog")?.standing).toBe("stale");
    }
  });

  it("cites a source on every principle, so none was invented here", () => {
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.principles.every((p) => p.source.trim().length > 0)).toBe(true);
      expect(parsed.doc.principles.length).toBeGreaterThanOrEqual(8);
    }
  });
});
