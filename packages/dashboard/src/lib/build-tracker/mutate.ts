import {
  importanceOrder,
  slugify,
  type Author,
  type Importance,
  type ItemState,
  type Lane,
  type ReadinessArea,
  type ReadinessLevel,
  type TrackedItem,
  type TrackerDoc,
} from "./schema";

/**
 * Every edit the tracker supports, as pure document transforms.
 *
 * Each takes a document and returns a new one. No I/O, no clock, no randomness —
 * timestamps are passed in by the caller so these stay deterministic and the
 * tests do not need to freeze time.
 *
 * The actions layer re-validates the result through `parseTracker` before it
 * reaches disk, so a transform that produced something invalid would be caught
 * rather than written.
 */

/** Gap between ranks, so an item can always be inserted between two others
 *  without renumbering the list. */
const RANK_STEP = 10;

export interface MutationResult {
  doc: TrackerDoc;
  /** True when the document actually changed. False is not an error — a no-op
   *  (moving the top item up) is a legitimate outcome the UI should not report
   *  as a failure. */
  changed: boolean;
  /** Present when the mutation was refused, explaining why in the user's terms. */
  refused?: string;
}

function unchanged(doc: TrackerDoc, refused?: string): MutationResult {
  return { doc, changed: false, ...(refused ? { refused } : {}) };
}

function withItems(doc: TrackerDoc, items: TrackedItem[], at: string, by: Author): TrackerDoc {
  return { ...doc, meta: { ...doc.meta, lastEditedAt: at, lastEditedBy: by }, items };
}

/** Frees a slug that is already taken by appending -2, -3, … The first item to
 *  claim a slug keeps it forever; ids are identity and are never reassigned. */
function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface NewItemInput {
  title: string;
  area: ReadinessArea;
  level: ReadinessLevel;
  state: ItemState;
  importance: Importance;
  lane?: Lane;
  gap?: string;
  works?: string;
  href?: string;
  note?: string;
}

/**
 * Adds an item the user typed. Always `origin: "user"`, which is the only origin
 * exempt from the provenance requirement — a person adding their own idea owes
 * no citation. An agent adding an item must supply provenance and therefore
 * cannot go through this path.
 */
export function addItem(doc: TrackerDoc, input: NewItemInput, at: string): MutationResult {
  const title = input.title.trim();
  if (title === "") return unchanged(doc, "A title is required.");

  const base = slugify(title);
  if (base === "") {
    return unchanged(doc, "That title has no letters or numbers to build an id from.");
  }

  const id = uniqueId(base, new Set(doc.items.map((i) => i.id)));
  const lane = input.lane ?? "idea";

  // Sits at the bottom of its own importance band, so adding something never
  // silently outranks work already triaged into that band.
  const band = doc.items.filter((i) => i.importance === input.importance);
  const rank = band.length === 0 ? RANK_STEP : Math.max(...band.map((i) => i.rank)) + RANK_STEP;

  const item: TrackedItem = {
    id,
    title,
    lane,
    area: input.area,
    level: input.level,
    state: input.state,
    importance: input.importance,
    rank,
    origin: "user",
    addedAt: at,
    addedBy: "user",
  };
  if (input.href) item.href = input.href;
  if (input.works) item.works = input.works;
  if (input.gap) item.gap = input.gap;
  if (input.note) item.provenance = { note: input.note };

  return { doc: withItems(doc, [...doc.items, item], at, "user"), changed: true };
}

/**
 * Drops a catalogued item — sets `state: "dropped"` and keeps the row.
 *
 * Deliberately not a delete. This tracker exists so ideas raised across many
 * sessions are not lost; deleting a catalogued idea is the exact failure it was
 * built to prevent. `backlog.md` already follows this convention, striking items
 * through rather than removing them. The UI labels the control "Drop", not
 * "Delete", so it does not overstate what it does.
 */
export function dropItem(
  doc: TrackerDoc,
  id: string,
  reason: string,
  at: string,
  by: Author = "user"
): MutationResult {
  const target = doc.items.find((i) => i.id === id);
  if (!target) return unchanged(doc, `No item with id "${id}".`);
  if (target.state === "dropped") return unchanged(doc);

  const items = doc.items.map((i) =>
    i.id === id
      ? {
          ...i,
          state: "dropped" as ItemState,
          droppedAt: at,
          droppedReason: reason.trim() || "No reason given.",
        }
      : i
  );
  return { doc: withItems(doc, items, at, by), changed: true };
}

/** Brings a dropped item back. Restores to `someday` rather than guessing the
 *  state it held before — an invented prior state would be a fabrication. */
export function restoreItem(
  doc: TrackerDoc,
  id: string,
  at: string,
  by: Author = "user"
): MutationResult {
  const target = doc.items.find((i) => i.id === id);
  if (!target) return unchanged(doc, `No item with id "${id}".`);
  if (target.state !== "dropped") return unchanged(doc);

  const items = doc.items.map((i) => {
    if (i.id !== id) return i;
    const { droppedAt: _droppedAt, droppedReason: _droppedReason, ...rest } = i;
    return { ...rest, state: "someday" as ItemState };
  });
  return { doc: withItems(doc, items, at, by), changed: true };
}

/**
 * Permanently removes an item — allowed **only** for something the user added
 * themselves. A seeded or catalogued row can be dropped but never destroyed,
 * because its provenance is the record of where the idea came from.
 */
export function removeUserItem(
  doc: TrackerDoc,
  id: string,
  at: string,
  by: Author = "user"
): MutationResult {
  const target = doc.items.find((i) => i.id === id);
  if (!target) return unchanged(doc, `No item with id "${id}".`);
  if (target.origin !== "user") {
    return unchanged(
      doc,
      "Only items you added can be deleted. Catalogued items are dropped instead, so the record of where the idea came from survives."
    );
  }
  const remaining = doc.items.filter((i) => i.id !== id);
  // Any blocker pointing at the removed item would fail validation, so clear it
  // here rather than letting the write be rejected with a confusing message.
  // Dropping to zero blockers removes the key entirely: an empty array would say
  // "we looked and there are none", which is not the same as "not blocked".
  const cleaned = remaining.map((i) => {
    if (!i.blockedBy?.includes(id)) return i;
    const kept = i.blockedBy.filter((b) => b !== id);
    if (kept.length > 0) return { ...i, blockedBy: kept };
    const { blockedBy: _cleared, ...rest } = i;
    return rest;
  });
  return { doc: withItems(doc, cleaned, at, by), changed: true };
}

/**
 * Moves an item one place within its own importance band by swapping ranks with
 * its neighbour. Movement is band-local on purpose: reordering must never
 * silently change how important something is. Changing importance is
 * `patchItem`'s job, and it is a separate, visible act.
 */
export function moveItem(
  doc: TrackerDoc,
  id: string,
  direction: "up" | "down",
  at: string,
  by: Author = "user"
): MutationResult {
  const target = doc.items.find((i) => i.id === id);
  if (!target) return unchanged(doc, `No item with id "${id}".`);

  const band = doc.items
    .filter((i) => i.importance === target.importance)
    .sort((a, b) => a.rank - b.rank);
  const index = band.findIndex((i) => i.id === id);
  const neighbour = direction === "up" ? band[index - 1] : band[index + 1];
  if (!neighbour) return unchanged(doc); // already at the edge — a no-op, not an error

  const items = doc.items.map((i) => {
    if (i.id === target.id) return { ...i, rank: neighbour.rank };
    if (i.id === neighbour.id) return { ...i, rank: target.rank };
    return i;
  });
  return { doc: withItems(doc, items, at, by), changed: true };
}

export type PatchableField = "level" | "state" | "importance" | "area" | "title";

/** Edits one field of one item. Unknown id is a no-op with a reason, never a throw. */
export function patchItem(
  doc: TrackerDoc,
  id: string,
  patch: Partial<Pick<TrackedItem, PatchableField>>,
  at: string,
  by: Author = "user"
): MutationResult {
  const target = doc.items.find((i) => i.id === id);
  if (!target) return unchanged(doc, `No item with id "${id}".`);

  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return unchanged(doc);

  const next = { ...target, ...patch };

  // Moving between importance bands must land somewhere deterministic, or the
  // item would inherit a rank that means nothing in its new band.
  if (patch.importance && patch.importance !== target.importance) {
    const band = doc.items.filter((i) => i.importance === patch.importance && i.id !== id);
    next.rank = band.length === 0 ? RANK_STEP : Math.max(...band.map((i) => i.rank)) + RANK_STEP;
  }

  const items = doc.items.map((i) => (i.id === id ? next : i));
  return { doc: withItems(doc, items, at, by), changed: true };
}

/** Records that a human checked this claim against the code today. */
export function markVerified(
  doc: TrackerDoc,
  id: string,
  at: string,
  by: Author = "user"
): MutationResult {
  const target = doc.items.find((i) => i.id === id);
  if (!target) return unchanged(doc, `No item with id "${id}".`);
  const items = doc.items.map((i) => (i.id === id ? { ...i, verifiedAt: at } : i));
  return { doc: withItems(doc, items, at, by), changed: true };
}

/** Re-spaces ranks to 10, 20, 30… within each importance band. Not used by the
 *  UI; kept for a maintainer who has hand-edited the file into a tangle. */
export function normaliseRanks(doc: TrackerDoc, at: string, by: Author = "agent"): MutationResult {
  const sorted = [...doc.items].sort(
    (a, b) => importanceOrder(a.importance) - importanceOrder(b.importance) || a.rank - b.rank
  );
  const counters = new Map<Importance, number>();
  const items = sorted.map((item) => {
    const next = (counters.get(item.importance) ?? 0) + RANK_STEP;
    counters.set(item.importance, next);
    return { ...item, rank: next };
  });
  const changed = items.some((item, i) => item.rank !== sorted[i].rank);
  return changed ? { doc: withItems(doc, items, at, by), changed: true } : unchanged(doc);
}
