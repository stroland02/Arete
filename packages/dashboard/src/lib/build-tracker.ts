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
export type State = "shipped" | "next" | "blocked" | "someday" | "needs-decision";
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
  provenance?: { doc?: string; session?: string };
  origin?: string;
  addedAt?: string;
  addedBy?: string;
  programmes?: ProgrammeRef[];
  /** Absent on every item today. Absence must render as "never verified". */
  verifiedAt?: string;
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
};

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

export function inventory(tracker: Tracker = loadTracker()): TrackerItem[] {
  return tracker.items.filter((i) => i.lane === "inventory");
}

export function ideas(tracker: Tracker = loadTracker()): TrackerItem[] {
  return tracker.items.filter((i) => i.lane === "idea");
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
    const rows = tracker.items.filter((i) =>
      i.programmes?.some((p) => p.programme === programme.id)
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
