import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Selectors over the master build tracker (`data/build-tracker.json`).
 *
 * The tracker is the single record of what Kuma is, what is left, and every
 * idea worth not losing. It is hand-authored and seeded from the docs it cites
 * in `meta.seededFrom` — deliberately not derived, because no runtime signal
 * can tell us whether a thing is honest, half-wired or merely planned.
 *
 * Two rules are encoded here rather than left to the page, because getting them
 * wrong makes the product lie:
 *
 * 1. **Readiness counts cover the inventory lane only.** The tracker holds 24
 *    inventory rows (things that exist as surfaces or capabilities) and 61
 *    ideas. Counting ideas in the summary would take "not wired up" from ~10 to
 *    ~60 and present a healthy product as a broken one. Ideas are a catalogue,
 *    not a defect list.
 * 2. **Nothing is ever rendered as verified unless it says so.** No item
 *    carries `verifiedAt` today, so every row reads "never verified". A tick we
 *    cannot justify is the exact failure this page exists to prevent.
 */

export type Lane = "inventory" | "idea";
export type Level = "live" | "preview" | "partial" | "soon";
export type State =
  | "shipped"
  | "next"
  | "blocked"
  | "someday"
  | "needs-decision"
  /**
   * Deliberately set aside — kept, not deleted. The write path must reach for
   * this instead of removing a row: losing a catalogued idea is the one failure
   * this tracker exists to prevent, so "remove" has to mean "move somewhere it
   * can still be read" for anything the team did not add by hand.
   */
  | "dropped";
export type Importance = "critical" | "high" | "medium" | "low";
export type Standing = "current" | "stale";

export interface ProgrammeRef {
  programme: string;
  phase: string;
}

export interface TrackerItem {
  id: string;
  title: string;
  lane: Lane;
  area: string;
  level: Level;
  state: State;
  importance: Importance;
  rank: number;
  blockedBy?: string[];
  href?: string;
  works?: string;
  gap?: string;
  evidence?: string;
  /**
   * Where this row came from, so any claim on the page is one Read from being
   * checked. `note` was stored on most rows and declared on none — anything
   * reading it failed to typecheck against data that has always carried it.
   * Counted before fixing: doc 86, note 72, session 2, across 88 rows.
   */
  provenance?: { doc?: string; note?: string; session?: string };
  origin?: string;
  addedAt?: string;
  addedBy?: string;
  programmes?: ProgrammeRef[];
  /** Absent on every item today. Absence must render as "never verified". */
  verifiedAt?: string;
  /** Set together with `state: "dropped"`. A drop with no reason is not a record. */
  droppedAt?: string;
  droppedReason?: string;
}

export interface Programme {
  id: string;
  label: string;
  standing: Standing;
  /** Why this programme's numbering can or cannot be trusted. Always shown. */
  caveat: string;
}

export interface Tracker {
  meta: {
    seededFrom: string[];
    seededAt: string;
    lastEditedAt?: string;
    lastEditedBy?: string;
  };
  mission: { northStar: string; statement: string; source: string };
  principles: { id: string; title: string; body: string }[];
  programmes: Programme[];
  items: TrackerItem[];
}

export const TRACKER_PATH = path.join(process.cwd(), "data", "build-tracker.json");

/** Importance bands, most important first. */
export const IMPORTANCE: Importance[] = ["critical", "high", "medium", "low"];

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  critical: "Blocks trust",
  high: "Next up",
  medium: "Planned",
  low: "Someday",
};

/**
 * Preferred display order for idea groups. This is an *ordering*, not a filter:
 * `ideaGroups` also emits any state not listed here, so an idea can never be
 * silently dropped from the catalogue by adding a new state to the data.
 */
export const IDEA_STATE_ORDER: State[] = [
  "next",
  "needs-decision",
  "blocked",
  "someday",
  "shipped",
];

export const STATE_LABELS: Record<State, string> = {
  shipped: "Shipped",
  next: "Next up",
  "needs-decision": "Needs a decision",
  blocked: "Blocked",
  someday: "Someday",
  dropped: "Dropped",
};

/** Blockers that no item id can satisfy — a person, a key, a third party. */
export const EXTERNAL_BLOCKER_PREFIX = "ext:";

/** Rank step. Sparse on purpose, so inserting between two rows never renumbers. */
export const RANK_STEP = 10;

const LEVEL_ORDER: Record<Level, number> = { soon: 0, partial: 1, preview: 2, live: 3 };
const IMPORTANCE_ORDER: Record<Importance, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

let cached: Tracker | null = null;

/**
 * Read the tracker. Cached in production only — in development the dev-side
 * editor writes this file, and the page must show the edit on the next request
 * rather than after a restart.
 */
export function loadTracker(): Tracker {
  if (cached && process.env.NODE_ENV === "production") return cached;
  const parsed = JSON.parse(readFileSync(TRACKER_PATH, "utf8")) as Tracker;
  cached = parsed;
  return parsed;
}

/**
 * Dropped rows are excluded from both lanes, and from every count derived from
 * them, because a dropped row is no longer part of the working picture. They are
 * not lost by that exclusion — `droppedItems` is the surface that shows them,
 * with the reason, and the page is expected to render it. Removing them from one
 * without adding the other would be a silent deletion with extra steps.
 */
export function inventory(tracker: Tracker = loadTracker()): TrackerItem[] {
  return tracker.items.filter((i) => i.lane === "inventory" && i.state !== "dropped");
}

export function ideas(tracker: Tracker = loadTracker()): TrackerItem[] {
  return tracker.items.filter((i) => i.lane === "idea" && i.state !== "dropped");
}

/** Everything set aside, most recently dropped first. Its own section on the page. */
export function droppedItems(tracker: Tracker = loadTracker()): TrackerItem[] {
  return tracker.items
    .filter((i) => i.state === "dropped")
    .sort((a, b) => (b.droppedAt ?? "").localeCompare(a.droppedAt ?? "") || a.rank - b.rank);
}

/** Still real work: neither finished nor set aside. */
export function isOpen(item: TrackerItem): boolean {
  return item.state !== "shipped" && item.state !== "dropped";
}

export interface ReadinessTotals {
  live: number;
  preview: number;
  partial: number;
  soon: number;
  /** How many rows the totals actually describe, so the figure can be labelled. */
  counted: number;
}

/**
 * Readiness counts across the **inventory lane only** — see rule 1 above.
 * `counted` is returned so the page can say what the number is out of instead
 * of implying it covers the whole tracker.
 */
export function readinessTotals(tracker: Tracker = loadTracker()): ReadinessTotals {
  const rows = inventory(tracker);
  return {
    live: rows.filter((i) => i.level === "live").length,
    preview: rows.filter((i) => i.level === "preview").length,
    partial: rows.filter((i) => i.level === "partial").length,
    soon: rows.filter((i) => i.level === "soon").length,
    counted: rows.length,
  };
}

/** Inventory rows in one importance band, worst-finished first. */
export function byImportance(
  importance: Importance,
  tracker: Tracker = loadTracker()
): TrackerItem[] {
  return inventory(tracker)
    .filter((i) => i.importance === importance)
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.rank - b.rank);
}

export interface IdeaGroup {
  state: State;
  label: string;
  items: TrackerItem[];
}

/**
 * The idea catalogue, grouped by what a reader can do about each one. Ordered
 * so actionable work leads and parked thinking trails — these are ideas worth
 * keeping, not a backlog of defects.
 */
export function ideaGroups(tracker: Tracker = loadTracker()): IdeaGroup[] {
  const rows = ideas(tracker);

  // Every state actually present, preferred order first, then anything new the
  // data has grown. Grouping must be exhaustive: a state missing from the order
  // list would otherwise drop those ideas from the page without a trace.
  const present = [...new Set(rows.map((i) => i.state))];
  const ordered = [
    ...IDEA_STATE_ORDER.filter((s) => present.includes(s)),
    ...present.filter((s) => !IDEA_STATE_ORDER.includes(s)),
  ];

  return ordered
    .map((state) => ({
      state,
      label: STATE_LABELS[state] ?? state,
      items: rows
        .filter((i) => i.state === state)
        .sort(
          (a, b) =>
            IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance] || a.rank - b.rank
        ),
    }))
    .filter((g) => g.items.length > 0);
}

export interface ProgrammeProgress extends Programme {
  /** Items counted as finished — `shipped` is the only state that means done. */
  done: number;
  total: number;
  /** Phases seen on this programme's items, in encounter order. */
  phases: string[];
}

/**
 * Progress per programme — four independent rails, never one blended bar.
 *
 * The four programmes number their phases separately and one of them is
 * explicitly stale, so a single combined percentage would be meaningless. Each
 * rail carries its own `caveat`, and the page is expected to render it.
 */
export function programmeProgress(tracker: Tracker = loadTracker()): ProgrammeProgress[] {
  return tracker.programmes.map((programme) => {
    // Dropped rows leave the denominator too — a programme does not become
    // less complete because work on it was abandoned rather than finished.
    const rows = tracker.items.filter(
      (i) => i.state !== "dropped" && i.programmes?.some((p) => p.programme === programme.id)
    );
    const phases: string[] = [];
    for (const row of rows) {
      for (const ref of row.programmes ?? []) {
        if (ref.programme === programme.id && !phases.includes(ref.phase)) phases.push(ref.phase);
      }
    }
    return {
      ...programme,
      done: rows.filter((i) => i.state === "shipped").length,
      total: rows.length,
      phases: phases.sort(),
    };
  });
}

/**
 * How to describe an item's verification. Absence of `verifiedAt` is reported
 * as never verified — never silently rendered as fine.
 */
export function verificationLabel(item: TrackerItem): string {
  return item.verifiedAt ? `Verified ${item.verifiedAt}` : "Never verified";
}

export function isVerified(item: TrackerItem): boolean {
  return Boolean(item.verifiedAt);
}

/**
 * The few things that most deserve attention next, across **both** lanes.
 *
 * Deliberately lane-blind: an unbuilt idea can matter more than a half-wired
 * surface, and a rail that could only ever show inventory would quietly rank
 * the catalogue below everything else. Finished and dropped rows are excluded —
 * neither is something to do next.
 */
export function focusRail(tracker: Tracker = loadTracker(), limit = 7): TrackerItem[] {
  return tracker.items
    .filter(isOpen)
    .sort(
      (a, b) =>
        IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance] || a.rank - b.rank
    )
    .slice(0, limit);
}

export type ResolvedBlocker =
  | { kind: "item"; id: string; title: string; state: State; done: boolean }
  | { kind: "external"; text: string }
  /** An id nothing matches. Surfaced, never dropped — see below. */
  | { kind: "unknown"; id: string };

/**
 * Turn `blockedBy` entries into something a reader can act on.
 *
 * Three cases, and the third is the reason this returns a union rather than a
 * list of strings: an id that matches no item is a broken reference, and the
 * honest thing is to say so. Silently filtering it out would make a blocked
 * item look unblocked, which is worse than showing a name nobody recognises.
 */
export function resolveBlockers(
  item: TrackerItem,
  tracker: Tracker = loadTracker()
): ResolvedBlocker[] {
  return (item.blockedBy ?? []).map((entry): ResolvedBlocker => {
    if (entry.startsWith(EXTERNAL_BLOCKER_PREFIX)) {
      return { kind: "external", text: entry.slice(EXTERNAL_BLOCKER_PREFIX.length).trim() };
    }
    const match = tracker.items.find((i) => i.id === entry);
    if (!match) return { kind: "unknown", id: entry };
    return {
      kind: "item",
      id: match.id,
      title: match.title,
      state: match.state,
      done: match.state === "shipped",
    };
  });
}

/**
 * The rank a newly added row should take: past the end, on the sparse step the
 * seeded data uses. `max + 1` would land a new row one apart from the last and
 * defeat the whole point of sparse ranks the first time someone reorders.
 */
export function nextRank(tracker: Tracker = loadTracker()): number {
  const max = tracker.items.reduce((acc, i) => Math.max(acc, i.rank ?? 0), 0);
  return (Math.floor(max / RANK_STEP) + 1) * RANK_STEP;
}
