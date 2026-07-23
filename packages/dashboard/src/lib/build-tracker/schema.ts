import type { ReadinessLevel } from "@/components/ui/readiness-badge";

/**
 * The master build tracker's type contract.
 *
 * One git-tracked JSON document (`packages/dashboard/data/build-tracker.json`)
 * is the single source of truth for what is built, what matters next, and every
 * idea that was proposed and never started. It is rendered at /build-status,
 * edited by a human from that page, and read directly by any agent planning work.
 *
 * This replaces `lib/feature-readiness.ts`, whose docblock bound it to
 * `docs/status/2026-07-22-build-status-map.md` with "update both together" — a
 * two-source contract that drifted and cost four repair commits. One file now.
 *
 * Everything here is a type or a frozen vocabulary. No I/O, no React, no Next.
 */

/** Type-only import, so this module pulls no component code into the graph. */
export type { ReadinessLevel };

// ---------------------------------------------------------------- vocabularies

/**
 * The four groupings the build-status page has always used, in render order.
 * Unchanged from `feature-readiness.ts` — this is the structure the product
 * owner reads the page by, and the migration must not disturb it.
 */
export const AREA_ORDER = [
  "Product surfaces",
  "Built, but unreachable",
  "Partially wired",
  "Not built yet",
] as const;
export type ReadinessArea = (typeof AREA_ORDER)[number];

/** Mirrors the CVA variants in `readiness-badge.tsx`. Kept as a runtime array so
 *  the parser can reject an unknown level rather than render a blank badge. */
export const LEVEL_ORDER = ["live", "preview", "partial", "soon"] as const;

/**
 * Which half of the page an item belongs to.
 *
 * `inventory` — an audited product surface. These are the rows the page has
 *   always shown, and they answer "how finished is this".
 * `idea` — something proposed and recorded but never started. These exist so a
 *   good idea raised in one session is not lost when that session ends.
 */
export const LANES = ["inventory", "idea"] as const;
export type Lane = (typeof LANES)[number];

/**
 * Where an item sits in our queue.
 *
 * Deliberately orthogonal to `level`: `level` answers "how finished is the
 * code", `state` answers "what are we doing about it". A thing can be `partial`
 * and `someday` at the same time, and collapsing the two would lose that.
 */
export const STATES = [
  "shipped",
  "in-progress",
  "next",
  "someday",
  "blocked",
  "needs-decision",
  "dropped",
] as const;
export type ItemState = (typeof STATES)[number];

/**
 * Coarse importance, most important first.
 *
 * These four words are chosen to match `severityTone()` in
 * `components/ui/severity-stripe.tsx`, which already maps critical/high →
 * danger, medium → warning, low → success. Reusing that mapping is what gives
 * the list its visual scale without a new primitive.
 */
export const IMPORTANCE_ORDER = ["critical", "high", "medium", "low"] as const;
export type Importance = (typeof IMPORTANCE_ORDER)[number];

/** How an item got into the tracker. `user` is the only origin exempt from the
 *  provenance requirement — a person adding their own idea owes no citation. */
export const ORIGINS = ["audit", "roadmap", "session", "user"] as const;
export type Origin = (typeof ORIGINS)[number];

export const AUTHORS = ["seed", "user", "agent"] as const;
export type Author = (typeof AUTHORS)[number];

/**
 * Honest status of a *numbering system*, not of the work inside it.
 *
 * `stale` is the load-bearing value: this repo has a roadmap that still lists
 * three shipped items as unstarted, and a reader needs to know that before
 * trusting any number in that row.
 */
export const STANDINGS = ["current", "stale", "superseded", "complete"] as const;
export type Standing = (typeof STANDINGS)[number];

export const PHASE_STATES = [
  "done",
  "in-progress",
  "not-started",
  "deferred",
  "stale",
] as const;
export type PhaseState = (typeof PHASE_STATES)[number];

/** Prefix marking a blocker that is not another tracked item — an external
 *  dependency, a decision, a bill. e.g. "ext:needs a funded Anthropic key". */
export const EXTERNAL_BLOCKER_PREFIX = "ext:";

// --------------------------------------------------------------------- shapes

/**
 * Where an idea was recorded, so any claim on the page is one `Read` away from
 * being checked. Required for every item except `origin: "user"` — see
 * `parse.ts`. This is the anti-fabrication rule made structural: an agent
 * cannot add a row to this tracker without citing its source.
 */
export interface Provenance {
  /** Repo-relative doc path, ideally with a section anchor. */
  doc?: string;
  /** Commit sha that shipped or recorded it. */
  commit?: string;
  /** A working session, when no doc captured it. */
  session?: string;
  /** Free text, when the above cannot express it. */
  note?: string;
}

/** Which programme and phase an item belongs to. An item may carry several,
 *  because the same work legitimately appears in more than one numbering
 *  system — forcing a single value is how they got conflated in the first place. */
export interface ProgrammeRef {
  /** A `Programme.id`. Validated to exist. */
  programme: string;
  /** A `Phase.key` within that programme. Validated to exist. */
  phase: string;
}

export interface TrackedItem {
  /**
   * Stable identity. A kebab-case slug, frozen the moment it is written.
   *
   * The old file used `name` as the React key, so renaming a row silently
   * destroyed its identity and its history. `id` never changes; `title` is free
   * to be reworded.
   */
  id: string;
  title: string;
  lane: Lane;
  area: ReadinessArea;
  level: ReadinessLevel;
  state: ItemState;
  importance: Importance;
  /**
   * Order within an importance band. Sparse (10, 20, 30…) so an insert between
   * two items never has to renumber the list.
   */
  rank: number;

  programmes?: ProgrammeRef[];
  /** Item ids, or `ext:`-prefixed free text. An item id that does not resolve
   *  is a parse error — a blocker pointing at nothing is worse than none. */
  blockedBy?: string[];

  /** Carried verbatim from the previous inventory. */
  href?: string;
  /** What is genuinely real today. */
  works?: string;
  /** What is missing — the honest gap. */
  gap?: string;
  /** file:line proof, so a reader can check the claim. */
  evidence?: string;

  provenance?: Provenance;
  origin: Origin;
  addedAt: string;
  addedBy: Author;

  /**
   * When a human last checked this claim against the code. Absent means "never
   * verified" and the page says so — absence must never read as verification.
   */
  verifiedAt?: string;

  droppedAt?: string;
  droppedReason?: string;
  tags?: string[];
}

export interface Phase {
  key: string;
  label: string;
  state: PhaseState;
  shippedAt?: string;
  /** Commit, gate report, or doc that evidences the phase's state. */
  evidence?: string;
}

/**
 * A numbering system, kept separate from every other numbering system.
 *
 * This repo runs four at once (product 1.1–1.6, SuperLog P1–P5, observability
 * 0–4, orchestration A–C) and merging them into one sequence would invent a
 * progression that does not exist. Each stands alone with its own caveat.
 */
export interface Programme {
  id: string;
  label: string;
  standing: Standing;
  /** The one sentence a reader needs *before* trusting any number in this row. */
  caveat: string;
  /** The doc that defines this numbering. */
  source: string;
  phases: Phase[];
}

export interface Mission {
  /** The north star, in one sentence. */
  northStar: string;
  /** What the product is, in a short paragraph. */
  statement: string;
  source: string;
}

/**
 * A principle we hold ourselves to. `source` is required and enforced: every
 * principle on this page must already be written down somewhere in this repo.
 * Authoring new ones here would be exactly the fabrication the product exists
 * to prevent.
 */
export interface Principle {
  id: string;
  title: string;
  body: string;
  source: string;
}

export interface TrackerMeta {
  /** Docs the seed was derived from. */
  seededFrom: string[];
  /** The audit date the seed reflects — not "now". */
  seededAt: string;
  lastEditedAt: string | null;
  lastEditedBy: Author | null;
}

export interface TrackerDoc {
  meta: TrackerMeta;
  mission: Mission;
  principles: Principle[];
  programmes: Programme[];
  items: TrackedItem[];
}

// ------------------------------------------------------------------- helpers

/** Sort key for importance, so `critical` sorts before `low`. */
export function importanceOrder(importance: Importance): number {
  return IMPORTANCE_ORDER.indexOf(importance);
}

/** True when a blocker string refers to something outside the tracker. */
export function isExternalBlocker(blocker: string): boolean {
  return blocker.startsWith(EXTERNAL_BLOCKER_PREFIX);
}

/** The human-readable half of an `ext:` blocker. */
export function externalBlockerText(blocker: string): string {
  return blocker.slice(EXTERNAL_BLOCKER_PREFIX.length).trim();
}

/**
 * Derives a stable id from a title. Collisions are resolved by the caller
 * (`mutate.addItem`), not here, so this stays pure and predictable.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
