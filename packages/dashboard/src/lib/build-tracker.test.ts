import { describe, expect, it } from "vitest";
import {
  droppedItems,
  focusRail,
  ideaGroups,
  ideas,
  inventory,
  loadTracker,
  nextRank,
  programmeProgress,
  readinessTotals,
  resolveBlockers,
  verificationLabel,
  type Tracker,
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

/**
 * The rest of this file uses a synthetic tracker. The real file carries no
 * dropped rows yet — which is exactly why these behaviours need a fixture: they
 * describe what must happen the first time someone presses Drop, and the real
 * data cannot exercise that until the damage is already possible.
 */
function fixture(items: Partial<TrackerItem>[]): Tracker {
  return {
    ...tracker,
    programmes: [{ id: "p", label: "P", standing: "current", caveat: "test fixture" }],
    items: items.map((item, index) => ({
      id: `i${index}`,
      title: `Item ${index}`,
      lane: "idea",
      area: "Not built yet",
      level: "soon",
      state: "someday",
      importance: "medium",
      rank: (index + 1) * 10,
      ...item,
    })) as TrackerItem[],
  };
}

describe("dropped items", () => {
  it("leave both lanes and every count derived from them", () => {
    const doc = fixture([
      { lane: "inventory", level: "live", state: "shipped" },
      { lane: "inventory", level: "soon", state: "dropped", droppedAt: "2026-07-23" },
      { lane: "idea", state: "dropped", droppedAt: "2026-07-23" },
      { lane: "idea", state: "next" },
    ]);

    expect(inventory(doc).map((i) => i.id)).toEqual(["i0"]);
    expect(ideas(doc).map((i) => i.id)).toEqual(["i3"]);
    expect(readinessTotals(doc).counted).toBe(1);
    expect(ideaGroups(doc).flatMap((g) => g.items.map((i) => i.id))).toEqual(["i3"]);
  });

  it("are still readable — exclusion from the lanes is not deletion", () => {
    const doc = fixture([
      { state: "dropped", droppedAt: "2026-07-20", droppedReason: "superseded" },
      { state: "dropped", droppedAt: "2026-07-23", droppedReason: "out of scope" },
      { state: "next" },
    ]);
    // Most recent first, and the reason travels with the row.
    expect(droppedItems(doc).map((i) => i.id)).toEqual(["i1", "i0"]);
    expect(droppedItems(doc)[0].droppedReason).toBe("out of scope");
  });

  it("do not flatter a programme by shrinking its denominator", () => {
    const doc = fixture([
      { state: "shipped", programmes: [{ programme: "p", phase: "1" }] },
      { state: "next", programmes: [{ programme: "p", phase: "2" }] },
      { state: "dropped", droppedAt: "2026-07-23", programmes: [{ programme: "p", phase: "3" }] },
    ]);
    const [rail] = programmeProgress(doc);
    // 1 of 2, not 1 of 3, and no phantom phase 3 on the rail.
    expect([rail.done, rail.total]).toEqual([1, 2]);
    expect(rail.phases).toEqual(["1", "2"]);
  });
});

describe("focus rail", () => {
  it("ranks by importance first, then rank, across both lanes", () => {
    const doc = fixture([
      { lane: "inventory", importance: "medium", rank: 10 },
      { lane: "idea", importance: "critical", rank: 90 },
      { lane: "inventory", importance: "high", rank: 20 },
      { lane: "idea", importance: "critical", rank: 30 },
    ]);
    expect(focusRail(doc).map((i) => i.id)).toEqual(["i3", "i1", "i2", "i0"]);
  });

  it("shows nothing that is finished or set aside", () => {
    const doc = fixture([
      { importance: "critical", state: "shipped" },
      { importance: "critical", state: "dropped", droppedAt: "2026-07-23" },
      { importance: "low", state: "someday" },
    ]);
    expect(focusRail(doc).map((i) => i.id)).toEqual(["i2"]);
  });

  it("honours the limit", () => {
    const doc = fixture(Array.from({ length: 12 }, () => ({})));
    expect(focusRail(doc)).toHaveLength(7);
    expect(focusRail(doc, 3)).toHaveLength(3);
  });
});

describe("blocker resolution", () => {
  const doc = fixture([
    { id: "blocker", title: "The thing in the way", state: "next" },
    { id: "done", title: "Already handled", state: "shipped" },
    { id: "subject", blockedBy: ["blocker", "done", "ext: a real Anthropic key", "typo-id"] },
  ]);
  const subject = doc.items.find((i) => i.id === "subject")!;

  it("names the blocking item instead of printing its id", () => {
    expect(resolveBlockers(subject, doc)[0]).toEqual({
      kind: "item",
      id: "blocker",
      title: "The thing in the way",
      state: "next",
      done: false,
    });
  });

  it("marks a shipped blocker as done rather than hiding it", () => {
    expect(resolveBlockers(subject, doc)[1]).toMatchObject({ id: "done", done: true });
  });

  it("reads an ext: blocker as prose, not as a missing item", () => {
    expect(resolveBlockers(subject, doc)[2]).toEqual({
      kind: "external",
      text: "a real Anthropic key",
    });
  });

  it("surfaces an id nothing matches — a broken reference is not an unblocked item", () => {
    // The tempting alternative is to filter it out. That would render this row
    // as carrying one fewer blocker than it claims, which is the lie.
    expect(resolveBlockers(subject, doc)[3]).toEqual({ kind: "unknown", id: "typo-id" });
    expect(resolveBlockers(subject, doc)).toHaveLength(4);
  });

  it("returns nothing for an item that lists no blockers", () => {
    expect(resolveBlockers(doc.items[0], doc)).toEqual([]);
  });
});

describe("next rank", () => {
  it("keeps the sparse step so a later insert never renumbers the list", () => {
    expect(nextRank(fixture([{ rank: 10 }, { rank: 20 }]))).toBe(30);
    // The bug this replaces: max + 1 would return 35 here, leaving no room
    // between 34 and the new row the very next time anything is reordered.
    expect(nextRank(fixture([{ rank: 34 }]))).toBe(40);
  });

  it("starts at the step, not at one, on an empty tracker", () => {
    expect(nextRank(fixture([]))).toBe(10);
  });
});

describe("the real tracker satisfies the new contract", () => {
  it("has no blocker pointing at an id that does not exist", () => {
    const broken = tracker.items.flatMap((item) =>
      resolveBlockers(item, tracker)
        .filter((b) => b.kind === "unknown")
        .map((b) => `${item.id} -> ${(b as { id: string }).id}`)
    );
    expect(broken).toEqual([]);
  });

  it("gives every dropped row a date and a reason", () => {
    for (const item of droppedItems(tracker)) {
      expect(item.droppedAt, `${item.id} was dropped with no date`).toBeTruthy();
      expect(item.droppedReason, `${item.id} was dropped with no reason`).toBeTruthy();
    }
  });
});

describe("provenance keeps the type honest about the data", () => {
  it("declares every provenance key the real tracker actually stores", () => {
    // Filed by the verify lane after dogfooding: the type said { doc, session }
    // while 72 rows carried `note`, so anything reading it failed to typecheck
    // against data that had always been there. Their report also said no row
    // used `session`; two do, so it stays. Checking the claim mattered more
    // than accepting it.
    const declared = new Set(["doc", "note", "session"]);
    const seen = new Set(tracker.items.flatMap((i) => Object.keys(i.provenance ?? {})));
    const undeclared = [...seen].filter((k) => !declared.has(k));
    expect(undeclared, `provenance keys stored but not declared: ${undeclared.join(", ")}`).toEqual([]);
  });

  it("gives every row a provenance, so no claim is unattributable", () => {
    const orphans = tracker.items.filter((i) => !i.provenance).map((i) => i.id);
    expect(orphans).toEqual([]);
  });
});
