import { describe, expect, it } from "vitest";
import {
  ideaGroups,
  ideas,
  inventory,
  loadTracker,
  programmeProgress,
  readinessTotals,
  verificationLabel,
  type TrackerItem,
} from "./build-tracker";

/**
 * These tests guard the two rules that stop the build-status page lying.
 * They run against the real `data/build-tracker.json`, not a fixture, because
 * the failure mode being prevented is the real file drifting away from the
 * assumptions the page makes about it.
 */

const tracker = loadTracker();

describe("readiness totals", () => {
  it("counts the inventory lane only", () => {
    const totals = readinessTotals(tracker);
    expect(totals.counted).toBe(inventory(tracker).length);
    expect(totals.live + totals.preview + totals.partial + totals.soon).toBe(totals.counted);
  });

  it("does not let ideas inflate the not-wired-up figure", () => {
    // The honesty rule: ideas are a catalogue, not a defect list. If they were
    // counted, "not wired up" would jump by roughly the whole idea lane and
    // present a working product as a broken one.
    const totals = readinessTotals(tracker);
    const soonAcrossEverything = tracker.items.filter((i) => i.level === "soon").length;
    expect(totals.soon).toBeLessThan(soonAcrossEverything);
    expect(totals.soon).toBe(inventory(tracker).filter((i) => i.level === "soon").length);
  });
});

describe("idea catalogue", () => {
  it("groups every idea exactly once", () => {
    const grouped = ideaGroups(tracker).flatMap((g) => g.items);
    expect(grouped).toHaveLength(ideas(tracker).length);
    expect(new Set(grouped.map((i) => i.id)).size).toBe(grouped.length);
  });

  it("never contains an inventory row", () => {
    for (const group of ideaGroups(tracker)) {
      for (const item of group.items) expect(item.lane).toBe("idea");
    }
  });
});

describe("programme rails", () => {
  it("returns one rail per programme, each carrying its caveat", () => {
    const rails = programmeProgress(tracker);
    expect(rails).toHaveLength(tracker.programmes.length);
    for (const rail of rails) {
      expect(rail.caveat.length).toBeGreaterThan(0);
      expect(rail.done).toBeLessThanOrEqual(rail.total);
    }
  });

  it("counts only shipped items as done, so the bar cannot overstate progress", () => {
    for (const rail of programmeProgress(tracker)) {
      const rows = tracker.items.filter((i) =>
        i.programmes?.some((p) => p.programme === rail.id)
      );
      expect(rail.done).toBe(rows.filter((i) => i.state === "shipped").length);
    }
  });

  it("still surfaces a programme whose own numbering is stale", () => {
    const stale = programmeProgress(tracker).filter((r) => r.standing === "stale");
    // Recorded rather than hidden — a stale programme is exactly the thing a
    // reader must not plan off unknowingly.
    for (const rail of stale) expect(rail.caveat).toMatch(/stale/i);
  });
});

describe("verification labelling", () => {
  it("reports a missing verifiedAt as never verified, never as a pass", () => {
    const unverified = { id: "x", verifiedAt: undefined } as unknown as TrackerItem;
    expect(verificationLabel(unverified)).toBe("Never verified");
  });

  it("only claims verification where the record actually carries a date", () => {
    for (const item of tracker.items) {
      const label = verificationLabel(item);
      if (item.verifiedAt) expect(label).toContain(item.verifiedAt);
      else expect(label).toBe("Never verified");
    }
  });
});
