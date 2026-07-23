import { describe, expect, it } from "vitest";
import {
  countByImportance,
  droppedItems,
  externallyBlocked,
  focusRail,
  groupByArea,
  ideaGroups,
  programmeProgress,
  readinessTotals,
  resolveBlockers,
  unverifiedCount,
} from "./select";
import type { Programme, TrackedItem, TrackerDoc } from "./schema";

function item(overrides: Partial<TrackedItem> = {}): TrackedItem {
  return {
    id: "an-item",
    title: "An item",
    lane: "inventory",
    area: "Product surfaces",
    level: "live",
    state: "shipped",
    importance: "medium",
    rank: 10,
    origin: "audit",
    addedAt: "2026-07-22",
    addedBy: "seed",
    provenance: { doc: "docs/status/2026-07-22-build-status-map.md" },
    ...overrides,
  };
}

function doc(items: TrackedItem[], programmes: Programme[] = []): TrackerDoc {
  return {
    meta: { seededFrom: [], seededAt: "2026-07-22", lastEditedAt: null, lastEditedBy: null },
    mission: { northStar: "n", statement: "s", source: "docs/x.md" },
    principles: [],
    programmes,
    items,
  };
}

describe("readinessTotals", () => {
  /**
   * The regression that would otherwise make the page's header lie: once the
   * idea catalogue is seeded, counting it would take "not wired up" from ten to
   * around sixty and turn an honest summary into an alarmist one.
   */
  it("counts the inventory lane only, never the idea catalogue", () => {
    const totals = readinessTotals(
      doc([
        item({ id: "a", lane: "inventory", level: "live" }),
        item({ id: "b", lane: "idea", level: "soon" }),
        item({ id: "c", lane: "idea", level: "soon" }),
      ])
    );
    expect(totals).toEqual({ live: 1, preview: 0, partial: 0, soon: 0 });
  });

  it("excludes dropped rows, which are no longer part of the product", () => {
    const totals = readinessTotals(
      doc([item({ id: "a", level: "live" }), item({ id: "b", level: "live", state: "dropped" })])
    );
    expect(totals.live).toBe(1);
  });

  it("returns a zeroed record for an empty tracker", () => {
    expect(readinessTotals(doc([]))).toEqual({ live: 0, preview: 0, partial: 0, soon: 0 });
  });
});

describe("groupByArea", () => {
  it("preserves the declared area order regardless of item order", () => {
    const groups = groupByArea(
      doc([
        item({ id: "a", area: "Not built yet" }),
        item({ id: "b", area: "Product surfaces" }),
        item({ id: "c", area: "Partially wired" }),
      ])
    );
    expect(groups.map((g) => g.area)).toEqual([
      "Product surfaces",
      "Partially wired",
      "Not built yet",
    ]);
  });

  it("omits empty areas, matching what the page has always done", () => {
    const groups = groupByArea(doc([item({ area: "Product surfaces" })]));
    expect(groups).toHaveLength(1);
  });

  it("does not mix the idea lane into the inventory", () => {
    const groups = groupByArea(doc([item({ id: "a", lane: "idea", area: "Product surfaces" })]));
    expect(groups).toHaveLength(0);
  });
});

describe("focusRail", () => {
  it("sorts by importance band, then by rank inside it", () => {
    const rail = focusRail(
      doc([
        item({ id: "low", importance: "low", rank: 10, state: "next" }),
        item({ id: "crit-b", importance: "critical", rank: 20, state: "next" }),
        item({ id: "crit-a", importance: "critical", rank: 10, state: "next" }),
      ])
    );
    expect(rail.map((i) => i.id)).toEqual(["crit-a", "crit-b", "low"]);
  });

  it("excludes shipped and dropped work", () => {
    const rail = focusRail(
      doc([
        item({ id: "done", state: "shipped" }),
        item({ id: "gone", state: "dropped" }),
        item({ id: "live-one", state: "blocked" }),
      ])
    );
    expect(rail.map((i) => i.id)).toEqual(["live-one"]);
  });

  /** The next most important thing is often an unbuilt idea; a rail that could
   *  only show audited surfaces would hide exactly that. */
  it("spans both lanes", () => {
    const rail = focusRail(
      doc([
        item({ id: "idea", lane: "idea", importance: "critical", state: "next" }),
        item({ id: "surface", lane: "inventory", importance: "low", state: "next" }),
      ])
    );
    expect(rail.map((i) => i.id)).toEqual(["idea", "surface"]);
  });

  it("caps at the requested limit", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      item({ id: `i${i}`, rank: i, state: "next" })
    );
    expect(focusRail(doc(many), 7)).toHaveLength(7);
  });

  it("is empty when everything is closed", () => {
    expect(focusRail(doc([item({ state: "shipped" })]))).toEqual([]);
  });
});

describe("programmeProgress", () => {
  const programmes: Programme[] = [
    {
      id: "product",
      label: "Product 1.1–1.6",
      standing: "complete",
      caveat: "Historical.",
      source: "docs/a.md",
      phases: [
        { key: "1.1", label: "Foundation", state: "done" },
        { key: "1.2", label: "GitHub App", state: "done" },
      ],
    },
    {
      id: "superlog",
      label: "SuperLog P1–P5",
      standing: "stale",
      caveat: "Lists three shipped items as unstarted.",
      source: "docs/b.md",
      phases: [
        { key: "P1", label: "Close the loop", state: "in-progress" },
        { key: "P2", label: "Relays", state: "not-started" },
      ],
    },
  ];

  /** Four numbering systems run at once here. A combined figure would invent a
   *  single progression that does not exist — the confusion this page ends. */
  it("reports per programme and never sums across them", () => {
    const progress = programmeProgress(doc([], programmes));
    expect(progress.map((p) => [p.programme.id, p.done, p.total])).toEqual([
      ["product", 2, 2],
      ["superlog", 0, 2],
    ]);
  });

  it("carries each programme's standing and caveat through untouched", () => {
    const [, superlog] = programmeProgress(doc([], programmes));
    expect(superlog.programme.standing).toBe("stale");
    expect(superlog.programme.caveat).toContain("unstarted");
  });
});

describe("resolveBlockers", () => {
  it("resolves an item blocker to its title and current state", () => {
    const blocker = item({ id: "token-expiry", title: "Internal token expiry", state: "next" });
    const blocked = item({ id: "proxy", blockedBy: ["token-expiry"] });
    expect(resolveBlockers(doc([blocker, blocked]), blocked)).toEqual([
      { label: "Internal token expiry", itemId: "token-expiry", state: "next" },
    ]);
  });

  it("passes an ext: blocker through as plain text", () => {
    const blocked = item({ id: "tuning", blockedBy: ["ext:needs a funded Anthropic key"] });
    expect(resolveBlockers(doc([blocked]), blocked)).toEqual([
      { label: "needs a funded Anthropic key" },
    ]);
  });

  it("returns nothing for an unblocked item", () => {
    expect(resolveBlockers(doc([item()]), item())).toEqual([]);
  });
});

describe("ideaGroups", () => {
  /** An untagged idea must still appear somewhere — silently dropping it from
   *  the page is the failure this catalogue exists to prevent. */
  it("files an untagged idea under 'not started' rather than hiding it", () => {
    const groups = ideaGroups(doc([item({ id: "orphan", lane: "idea", state: "someday" })]));
    expect(groups.map((g) => g.tag)).toEqual(["unstarted"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["orphan"]);
  });

  it("groups by tag and omits empty groups", () => {
    const groups = ideaGroups(
      doc([
        item({ id: "a", lane: "idea", state: "someday", tags: ["unreachable"] }),
        item({ id: "b", lane: "idea", state: "someday", tags: ["needs-ruling"] }),
      ])
    );
    expect(groups.map((g) => g.tag)).toEqual(["unreachable", "needs-ruling"]);
  });

  it("ignores the inventory lane", () => {
    expect(ideaGroups(doc([item({ lane: "inventory" })]))).toEqual([]);
  });
});

describe("droppedItems", () => {
  it("returns only dropped rows, so they stay visible rather than vanishing", () => {
    const list = droppedItems(
      doc([item({ id: "gone", state: "dropped" }), item({ id: "here", state: "next" })])
    );
    expect(list.map((i) => i.id)).toEqual(["gone"]);
  });
});

describe("unverifiedCount", () => {
  it("counts open items nobody has checked against the code", () => {
    const count = unverifiedCount(
      doc([
        item({ id: "a", state: "next" }),
        item({ id: "b", state: "next", verifiedAt: "2026-07-22" }),
        item({ id: "c", state: "shipped" }),
      ])
    );
    expect(count).toBe(1);
  });
});

describe("countByImportance", () => {
  it("counts open work per band", () => {
    const counts = countByImportance(
      doc([
        item({ id: "a", importance: "critical", state: "next" }),
        item({ id: "b", importance: "critical", state: "shipped" }),
        item({ id: "c", importance: "low", state: "blocked" }),
      ])
    );
    expect(counts).toEqual({ critical: 1, high: 0, medium: 0, low: 1 });
  });
});

describe("externallyBlocked", () => {
  it("finds work nothing we do can unstick", () => {
    const list = externallyBlocked(
      doc([
        item({ id: "waiting", state: "blocked", blockedBy: ["ext:needs a funded key"] }),
        item({ id: "ours", state: "blocked", blockedBy: ["waiting"] }),
      ])
    );
    expect(list.map((i) => i.id)).toEqual(["waiting"]);
  });
});
