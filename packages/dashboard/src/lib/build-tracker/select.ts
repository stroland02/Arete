import {
  AREA_ORDER,
  externalBlockerText,
  importanceOrder,
  isExternalBlocker,
  type Importance,
  type ItemState,
  type Programme,
  type ReadinessArea,
  type ReadinessLevel,
  type TrackedItem,
  type TrackerDoc,
} from "./schema";

/**
 * Pure projections of the tracker document, for the page and the CLI brief.
 *
 * Kept separate from rendering so every one of them can be asserted directly —
 * this repo's tests run without a DOM, so any logic worth checking has to live
 * in a function rather than in JSX.
 */

/** States that mean "there is nothing left to decide here". */
const CLOSED_STATES: ReadonlySet<ItemState> = new Set<ItemState>(["shipped", "dropped"]);

export function isOpen(item: TrackedItem): boolean {
  return !CLOSED_STATES.has(item.state);
}

/** Sorts by importance band, then by rank inside it. */
export function byImportanceThenRank(a: TrackedItem, b: TrackedItem): number {
  return importanceOrder(a.importance) - importanceOrder(b.importance) || a.rank - b.rank;
}

/**
 * Counts for the summary chips.
 *
 * **Inventory only, deliberately.** The chips describe how finished the product
 * is; counting the never-built idea catalogue would push "not wired up" from ten
 * to somewhere near sixty and turn an honest summary into an alarmist one. The
 * ideas get their own count, separately labelled.
 */
export function readinessTotals(doc: TrackerDoc): Record<ReadinessLevel, number> {
  const totals: Record<ReadinessLevel, number> = { live: 0, preview: 0, partial: 0, soon: 0 };
  for (const item of doc.items) {
    if (item.lane !== "inventory") continue;
    if (item.state === "dropped") continue;
    totals[item.level] += 1;
  }
  return totals;
}

export interface AreaGroup {
  area: ReadinessArea;
  items: TrackedItem[];
}

/**
 * The inventory, grouped exactly as the page has always shown it: the four areas
 * in their declared order, with empty areas omitted.
 */
export function groupByArea(doc: TrackerDoc, lane: "inventory" | "idea" = "inventory"): AreaGroup[] {
  return AREA_ORDER.map((area) => ({
    area,
    items: doc.items
      .filter((i) => i.lane === lane && i.area === area && i.state !== "dropped")
      .sort(byImportanceThenRank),
  })).filter((group) => group.items.length > 0);
}

/**
 * The top open items across both lanes — what to look at next.
 *
 * Spans inventory and ideas on purpose: the most important thing to do next is
 * frequently an unbuilt idea, and a rail that could only ever show audited
 * surfaces would hide exactly that.
 */
export function focusRail(doc: TrackerDoc, limit = 7): TrackedItem[] {
  return doc.items.filter(isOpen).sort(byImportanceThenRank).slice(0, limit);
}

export interface ProgrammeProgress {
  programme: Programme;
  done: number;
  total: number;
}

/**
 * Per-programme phase progress.
 *
 * Never summed across programmes. Four numbering systems run here at once and a
 * combined "23 of 31 phases" figure would invent a single progression that does
 * not exist — the specific confusion this page was built to end.
 */
export function programmeProgress(doc: TrackerDoc): ProgrammeProgress[] {
  return doc.programmes.map((programme) => ({
    programme,
    done: programme.phases.filter((p) => p.state === "done").length,
    total: programme.phases.length,
  }));
}

export interface ResolvedBlocker {
  /** What to show: another item's title, or the text of an external blocker. */
  label: string;
  /** Present only when the blocker is another tracked item. */
  itemId?: string;
  /** The blocking item's state, so the UI can say whether it is moving. */
  state?: ItemState;
}

/** Turns raw blocker strings into something renderable. */
export function resolveBlockers(doc: TrackerDoc, item: TrackedItem): ResolvedBlocker[] {
  return (item.blockedBy ?? []).map((blocker) => {
    if (isExternalBlocker(blocker)) return { label: externalBlockerText(blocker) };
    const target = doc.items.find((i) => i.id === blocker);
    // `parseTracker` guarantees this resolves, so the fallback is defensive only.
    return target
      ? { label: target.title, itemId: target.id, state: target.state }
      : { label: blocker };
  });
}

/**
 * How an idea came to be lost, which is the useful way to group the catalogue —
 * it tells a reader what kind of action would unstick it.
 */
export const IDEA_GROUPS = [
  {
    tag: "dispatched",
    title: "Dispatched, then vanished",
    blurb:
      "Assigned in a session that ended before it landed. Check what exists before rebuilding.",
  },
  {
    tag: "unreachable",
    title: "Built, but nobody can reach it",
    blurb: "The capability is merged and tested. It has no way in.",
  },
  {
    tag: "unstarted",
    title: "Roadmap phases not started",
    blurb: "Planned, scoped, never begun.",
  },
  {
    tag: "needs-ruling",
    title: "Awaiting a human ruling",
    blurb: "Blocked on a decision, not on code.",
  },
] as const;

export type IdeaGroupTag = (typeof IDEA_GROUPS)[number]["tag"];

export interface IdeaGroup {
  tag: IdeaGroupTag;
  title: string;
  blurb: string;
  items: TrackedItem[];
}

/** Groups the idea lane by its `tags`. Anything untagged falls into `unstarted`,
 *  so an idea can never be silently dropped from the page by a missing tag. */
export function ideaGroups(doc: TrackerDoc): IdeaGroup[] {
  const ideas = doc.items.filter((i) => i.lane === "idea" && i.state !== "dropped");
  const known = new Set<string>(IDEA_GROUPS.map((g) => g.tag));

  return IDEA_GROUPS.map((group) => ({
    ...group,
    items: ideas
      .filter((item) => {
        const tags = (item.tags ?? []).filter((t) => known.has(t));
        return tags.length === 0 ? group.tag === "unstarted" : tags.includes(group.tag);
      })
      .sort(byImportanceThenRank),
  })).filter((group) => group.items.length > 0);
}

export function droppedItems(doc: TrackerDoc): TrackedItem[] {
  return doc.items.filter((i) => i.state === "dropped").sort(byImportanceThenRank);
}

/**
 * How many open claims nobody has checked against the code.
 *
 * Surfaced as a standing nag on the page and in the CLI brief. It does not stop
 * the tracker going stale — nothing can — but it makes staleness visible, which
 * is the most this design can honestly claim.
 */
export function unverifiedCount(doc: TrackerDoc): number {
  return doc.items.filter((i) => isOpen(i) && i.verifiedAt === undefined).length;
}

export function countByImportance(doc: TrackerDoc): Record<Importance, number> {
  const counts: Record<Importance, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of doc.items) {
    if (isOpen(item)) counts[item.importance] += 1;
  }
  return counts;
}

/** Open items whose blockers are all external — nothing we do unsticks these. */
export function externallyBlocked(doc: TrackerDoc): TrackedItem[] {
  return doc.items.filter(
    (i) =>
      isOpen(i) && (i.blockedBy?.length ?? 0) > 0 && i.blockedBy!.every((b) => isExternalBlocker(b))
  );
}
