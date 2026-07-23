import { describe, expect, it } from "vitest";
import { parseTracker } from "./parse";
import {
  addItem,
  dropItem,
  markVerified,
  moveItem,
  normaliseRanks,
  patchItem,
  removeUserItem,
  restoreItem,
} from "./mutate";
import type { TrackedItem, TrackerDoc } from "./schema";

const NOW = "2026-07-23";

function item(overrides: Partial<TrackedItem> = {}): TrackedItem {
  return {
    id: "seeded-item",
    title: "Seeded item",
    lane: "inventory",
    area: "Partially wired",
    level: "partial",
    state: "next",
    importance: "high",
    rank: 10,
    origin: "audit",
    addedAt: "2026-07-22",
    addedBy: "seed",
    provenance: { doc: "docs/status/2026-07-22-build-status-map.md" },
    ...overrides,
  };
}

function doc(items: TrackedItem[] = [item()]): TrackerDoc {
  return {
    meta: { seededFrom: [], seededAt: "2026-07-22", lastEditedAt: null, lastEditedBy: null },
    mission: { northStar: "n", statement: "s", source: "docs/x.md" },
    principles: [],
    programmes: [],
    items,
  };
}

/** Every mutation must leave a document the parser still accepts, or the write
 *  path would reject it with a message the user cannot act on. */
function expectValid(d: TrackerDoc): void {
  const result = parseTracker(JSON.parse(JSON.stringify(d)));
  expect(result.ok ? [] : result.errors).toEqual([]);
}

describe("addItem", () => {
  const input = {
    title: "Slack relay",
    area: "Not built yet" as const,
    level: "soon" as const,
    state: "someday" as const,
    importance: "medium" as const,
  };

  it("slugifies the title into a stable id", () => {
    const { doc: next } = addItem(doc(), input, NOW);
    expect(next.items.at(-1)?.id).toBe("slack-relay");
  });

  it("suffixes the id on collision rather than reusing one", () => {
    const existing = item({ id: "slack-relay", title: "Slack relay" });
    const { doc: next } = addItem(doc([existing]), input, NOW);
    expect(next.items.at(-1)?.id).toBe("slack-relay-2");
  });

  it("marks it user-added, which is what exempts it from needing provenance", () => {
    const { doc: next } = addItem(doc(), input, NOW);
    const added = next.items.at(-1)!;
    expect(added.origin).toBe("user");
    expect(added.addedBy).toBe("user");
    expect(added.provenance).toBeUndefined();
    expectValid(next);
  });

  it("lands at the bottom of its own importance band, not the top", () => {
    const existing = item({ id: "a", importance: "medium", rank: 40 });
    const { doc: next } = addItem(doc([existing]), input, NOW);
    expect(next.items.at(-1)?.rank).toBe(50);
  });

  it("refuses an empty title", () => {
    const result = addItem(doc(), { ...input, title: "   " }, NOW);
    expect(result.changed).toBe(false);
    expect(result.refused).toContain("title is required");
  });

  it("refuses a title with nothing to build an id from", () => {
    const result = addItem(doc(), { ...input, title: "!!! ???" }, NOW);
    expect(result.changed).toBe(false);
    expect(result.refused).toContain("no letters or numbers");
  });

  it("stamps the edit onto meta", () => {
    const { doc: next } = addItem(doc(), input, NOW);
    expect(next.meta.lastEditedAt).toBe(NOW);
    expect(next.meta.lastEditedBy).toBe("user");
  });
});

describe("dropItem", () => {
  it("keeps the row and records why, rather than deleting it", () => {
    const { doc: next, changed } = dropItem(doc(), "seeded-item", "Superseded", NOW);
    expect(changed).toBe(true);
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ state: "dropped", droppedReason: "Superseded" });
    expectValid(next);
  });

  it("records an honest placeholder when no reason is given", () => {
    const { doc: next } = dropItem(doc(), "seeded-item", "  ", NOW);
    expect(next.items[0].droppedReason).toBe("No reason given.");
  });

  it("is a no-op on an already-dropped item", () => {
    const once = dropItem(doc(), "seeded-item", "x", NOW).doc;
    expect(dropItem(once, "seeded-item", "y", NOW).changed).toBe(false);
  });

  it("refuses an unknown id without throwing", () => {
    const result = dropItem(doc(), "ghost", "x", NOW);
    expect(result.changed).toBe(false);
    expect(result.refused).toContain("ghost");
  });
});

describe("restoreItem", () => {
  it("clears the drop fields and returns the item to someday", () => {
    const dropped = dropItem(doc(), "seeded-item", "x", NOW).doc;
    const { doc: next } = restoreItem(dropped, "seeded-item", NOW);
    expect(next.items[0].state).toBe("someday");
    expect(next.items[0].droppedAt).toBeUndefined();
    expect(next.items[0].droppedReason).toBeUndefined();
    expectValid(next);
  });

  it("is a no-op on an item that was never dropped", () => {
    expect(restoreItem(doc(), "seeded-item", NOW).changed).toBe(false);
  });
});

describe("removeUserItem", () => {
  const userItem = item({ id: "mine", origin: "user", addedBy: "user", provenance: undefined });

  it("deletes an item the user added", () => {
    const { doc: next, changed } = removeUserItem(doc([userItem]), "mine", NOW);
    expect(changed).toBe(true);
    expect(next.items).toHaveLength(0);
  });

  /** The catalogue's whole purpose is that ideas survive the session that raised
   *  them. Destroying a seeded row would defeat it. */
  it("refuses to delete a seeded item, and says why", () => {
    const result = removeUserItem(doc(), "seeded-item", NOW);
    expect(result.changed).toBe(false);
    expect(result.refused).toContain("dropped instead");
    expect(result.doc.items).toHaveLength(1);
  });

  it("clears blockers pointing at the removed item, so the doc stays valid", () => {
    const blocked = item({ id: "blocked", blockedBy: ["mine"] });
    const { doc: next } = removeUserItem(doc([userItem, blocked]), "mine", NOW);
    expect(next.items[0].blockedBy).toBeUndefined();
    expectValid(next);
  });
});

describe("moveItem", () => {
  const a = item({ id: "a", rank: 10, importance: "high" });
  const b = item({ id: "b", rank: 20, importance: "high" });
  const other = item({ id: "c", rank: 5, importance: "low" });

  it("swaps ranks with the neighbour above", () => {
    const { doc: next } = moveItem(doc([a, b]), "b", "up", NOW);
    expect(next.items.find((i) => i.id === "b")?.rank).toBe(10);
    expect(next.items.find((i) => i.id === "a")?.rank).toBe(20);
  });

  it("is a no-op at the top of the band", () => {
    expect(moveItem(doc([a, b]), "a", "up", NOW).changed).toBe(false);
  });

  it("is a no-op at the bottom of the band", () => {
    expect(moveItem(doc([a, b]), "b", "down", NOW).changed).toBe(false);
  });

  /** Reordering must never silently change how important something is. */
  it("never crosses an importance band", () => {
    const { changed } = moveItem(doc([a, other]), "a", "down", NOW);
    expect(changed).toBe(false);
  });
});

describe("patchItem", () => {
  it("changes one field and leaves the rest alone", () => {
    const { doc: next } = patchItem(doc(), "seeded-item", { level: "live" }, NOW);
    expect(next.items[0].level).toBe("live");
    expect(next.items[0].title).toBe("Seeded item");
    expectValid(next);
  });

  it("re-ranks into the bottom of the destination band on an importance change", () => {
    const existing = item({ id: "other", importance: "critical", rank: 30 });
    const { doc: next } = patchItem(
      doc([item(), existing]),
      "seeded-item",
      { importance: "critical" },
      NOW
    );
    expect(next.items.find((i) => i.id === "seeded-item")?.rank).toBe(40);
  });

  it("is a no-op with an empty patch", () => {
    expect(patchItem(doc(), "seeded-item", {}, NOW).changed).toBe(false);
  });

  it("refuses an unknown id without throwing", () => {
    expect(patchItem(doc(), "ghost", { level: "live" }, NOW).refused).toContain("ghost");
  });
});

describe("markVerified", () => {
  it("stamps the date a human checked the claim", () => {
    const { doc: next } = markVerified(doc(), "seeded-item", NOW);
    expect(next.items[0].verifiedAt).toBe(NOW);
    expectValid(next);
  });
});

describe("normaliseRanks", () => {
  it("re-spaces each band to 10, 20, 30 without reordering it", () => {
    const messy = doc([
      item({ id: "a", importance: "high", rank: 3 }),
      item({ id: "b", importance: "high", rank: 7 }),
      item({ id: "c", importance: "low", rank: 99 }),
    ]);
    const { doc: next } = normaliseRanks(messy, NOW);
    expect(next.items.find((i) => i.id === "a")?.rank).toBe(10);
    expect(next.items.find((i) => i.id === "b")?.rank).toBe(20);
    expect(next.items.find((i) => i.id === "c")?.rank).toBe(10);
    expectValid(next);
  });

  it("is a no-op when ranks are already normal", () => {
    const tidy = doc([item({ id: "a", importance: "high", rank: 10 })]);
    expect(normaliseRanks(tidy, NOW).changed).toBe(false);
  });
});
