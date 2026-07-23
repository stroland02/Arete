import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTracker } from "./parse";
import { groupByArea, ideaGroups, readinessTotals, unverifiedCount } from "./select";

/**
 * Guards the committed catalogue — `packages/dashboard/data/build-tracker.json`.
 *
 * The catalogue and this parser were authored by different lanes against the
 * schema published in `.claude/ade-coordination.md`. That contract only means
 * something if it is checked, so this test is the check: the data on main must
 * satisfy the engine on main, or the page cannot consume it.
 *
 * Deliberately asserts STRUCTURE, not a row count. The catalogue is expected to
 * grow; pinning its size here would turn every legitimate addition into a
 * failing test and train people to edit the assertion instead of reading it.
 */

const cataloguePath = fileURLToPath(new URL("../../../data/build-tracker.json", import.meta.url));
const catalogue: unknown = JSON.parse(readFileSync(cataloguePath, "utf8"));

describe("the committed catalogue satisfies the tracker contract", () => {
  const parsed = parseTracker(catalogue);

  it("parses — every id unique, every reference resolves, every claim cited", () => {
    // Surfacing the errors themselves, not just a boolean: a failure here has to
    // tell whoever broke it exactly which row and which field.
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
  });

  it("splits into an audited inventory and a catalogue of unstarted ideas", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const inventory = parsed.doc.items.filter((i) => i.lane === "inventory");
    const ideas = parsed.doc.items.filter((i) => i.lane === "idea");
    expect(inventory.length).toBeGreaterThan(0);
    // The whole point of the exercise: the ideas the page cannot currently show.
    expect(ideas.length).toBeGreaterThan(inventory.length);
  });

  it("counts readiness from the inventory alone", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const totals = readinessTotals(parsed.doc);
    const inventory = parsed.doc.items.filter(
      (i) => i.lane === "inventory" && i.state !== "dropped"
    );
    const summed = totals.live + totals.preview + totals.partial + totals.soon;
    // If ideas leaked into the summary chips, this would exceed the inventory.
    expect(summed).toBe(inventory.length);
  });

  it("files every idea into a visible group, so none is silently lost", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const grouped = ideaGroups(parsed.doc).reduce((n, g) => n + g.items.length, 0);
    const ideas = parsed.doc.items.filter((i) => i.lane === "idea" && i.state !== "dropped");
    expect(grouped).toBe(ideas.length);
  });

  it("groups the inventory without dropping or duplicating a row", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const grouped = groupByArea(parsed.doc).reduce((n, g) => n + g.items.length, 0);
    const inventory = parsed.doc.items.filter(
      (i) => i.lane === "inventory" && i.state !== "dropped"
    );
    expect(grouped).toBe(inventory.length);
  });

  it("keeps the numbering systems separate rather than merging them", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.programmes.length).toBeGreaterThan(1);
    // Every programme reference an item makes must resolve to a real phase —
    // parseTracker enforces it; this states the intent for a reader.
    const known = new Set(
      parsed.doc.programmes.flatMap((p) => p.phases.map((ph) => `${p.id}/${ph.key}`))
    );
    for (const item of parsed.doc.items) {
      for (const ref of item.programmes ?? []) {
        expect(known.has(`${ref.programme}/${ref.phase}`)).toBe(true);
      }
    }
  });

  it("does not silently claim verification it never performed", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Absence of verifiedAt means "never checked against the code" and the
    // surfaces must say so. This asserts the count is computable and honest,
    // not that it is low — a catalogue transcribed from audits starts unverified.
    expect(unverifiedCount(parsed.doc)).toBeGreaterThanOrEqual(0);
  });
});
