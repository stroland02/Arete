import {
  AREA_ORDER,
  AUTHORS,
  IMPORTANCE_ORDER,
  LANES,
  LEVEL_ORDER,
  ORIGINS,
  PHASE_STATES,
  STANDINGS,
  STATES,
  isExternalBlocker,
  type Mission,
  type Phase,
  type Principle,
  type Programme,
  type ProgrammeRef,
  type Provenance,
  type TrackedItem,
  type TrackerDoc,
  type TrackerMeta,
} from "./schema";

/**
 * Reading and writing the tracker document.
 *
 * Two jobs, and both are load-bearing:
 *
 * 1. `parseTracker` is the gate. Every write goes through it — the actions parse
 *    the *result* of a mutation before it reaches disk, so a transform that
 *    produces an invalid document can never corrupt the source of truth.
 *
 * 2. `serializeTracker` writes with a fixed key order and stable formatting, so
 *    changing one field produces a one-line git diff. That is what makes the
 *    tracker's history reviewable, which is much of why it is a file at all.
 *
 * Pure. No I/O — see `store.ts` for that.
 */

export type ParseResult =
  | { ok: true; doc: TrackerDoc }
  | { ok: false; errors: string[] };

/** Collects errors instead of throwing on the first, so a hand-edited file
 *  reports everything wrong with it in one pass rather than one thing per run. */
class Errors {
  readonly list: string[] = [];
  add(message: string): void {
    this.list.push(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(
  value: unknown,
  path: string,
  errors: Errors,
  { required = true }: { required?: boolean } = {}
): string | undefined {
  if (value === undefined || value === null) {
    if (required) errors.add(`${path} is required`);
    return undefined;
  }
  if (typeof value !== "string") {
    errors.add(`${path} must be a string`);
    return undefined;
  }
  if (required && value.trim() === "") {
    errors.add(`${path} must not be empty`);
    return undefined;
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: Errors
): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.add(
      `${path} must be one of ${allowed.join(" | ")} (got ${JSON.stringify(value)})`
    );
    return undefined;
  }
  return value as T;
}

function strArray(value: unknown, path: string, errors: Errors): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    errors.add(`${path} must be an array of strings`);
    return undefined;
  }
  return value as string[];
}

function parseProvenance(
  value: unknown,
  path: string,
  errors: Errors
): Provenance | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.add(`${path} must be an object`);
    return undefined;
  }
  const out: Provenance = {};
  for (const key of ["doc", "commit", "session", "note"] as const) {
    const v = str(value[key], `${path}.${key}`, errors, { required: false });
    if (v !== undefined) out[key] = v;
  }
  if (Object.keys(out).length === 0) {
    errors.add(`${path} must name at least one of doc, commit, session, note`);
  }
  return out;
}

function parseItem(value: unknown, index: number, errors: Errors): TrackedItem | undefined {
  const path = `items[${index}]`;
  if (!isRecord(value)) {
    errors.add(`${path} must be an object`);
    return undefined;
  }

  const id = str(value.id, `${path}.id`, errors);
  // Once we know the id, name errors by it — "items[webhook-ui].level" is far
  // easier to act on than "items[37].level" in a 600-line file.
  const label = id ? `items[${id}]` : path;

  const title = str(value.title, `${label}.title`, errors);
  const lane = oneOf(value.lane, LANES, `${label}.lane`, errors);
  const area = oneOf(value.area, AREA_ORDER, `${label}.area`, errors);
  const level = oneOf(value.level, LEVEL_ORDER, `${label}.level`, errors);
  const state = oneOf(value.state, STATES, `${label}.state`, errors);
  const importance = oneOf(value.importance, IMPORTANCE_ORDER, `${label}.importance`, errors);
  const origin = oneOf(value.origin, ORIGINS, `${label}.origin`, errors);
  const addedBy = oneOf(value.addedBy, AUTHORS, `${label}.addedBy`, errors);
  const addedAt = str(value.addedAt, `${label}.addedAt`, errors);

  const rank = value.rank;
  if (typeof rank !== "number" || !Number.isInteger(rank)) {
    errors.add(`${label}.rank must be an integer (got ${JSON.stringify(rank)})`);
  }

  const provenance = parseProvenance(value.provenance, `${label}.provenance`, errors);

  /**
   * The anti-fabrication rule, enforced rather than requested. Anything not
   * added by a human must say where the idea came from, so no claim reaches
   * this page without a path a reader can follow.
   */
  if (origin !== undefined && origin !== "user" && provenance === undefined) {
    errors.add(
      `${label}.provenance is required because origin is "${origin}" — cite the doc, commit, or session that recorded it`
    );
  }

  let programmes: ProgrammeRef[] | undefined;
  if (value.programmes !== undefined) {
    if (!Array.isArray(value.programmes)) {
      errors.add(`${label}.programmes must be an array`);
    } else {
      const refs: ProgrammeRef[] = [];
      value.programmes.forEach((ref, i) => {
        if (!isRecord(ref)) {
          errors.add(`${label}.programmes[${i}] must be an object`);
          return;
        }
        const programme = str(ref.programme, `${label}.programmes[${i}].programme`, errors);
        const phase = str(ref.phase, `${label}.programmes[${i}].phase`, errors);
        if (programme && phase) refs.push({ programme, phase });
      });
      programmes = refs;
    }
  }

  const blockedBy = strArray(value.blockedBy, `${label}.blockedBy`, errors);
  const tags = strArray(value.tags, `${label}.tags`, errors);

  if (
    id === undefined ||
    title === undefined ||
    lane === undefined ||
    area === undefined ||
    level === undefined ||
    state === undefined ||
    importance === undefined ||
    origin === undefined ||
    addedBy === undefined ||
    addedAt === undefined ||
    typeof rank !== "number"
  ) {
    return undefined;
  }

  const item: TrackedItem = {
    id,
    title,
    lane,
    area,
    level,
    state,
    importance,
    rank,
    origin,
    addedAt,
    addedBy,
  };

  if (programmes && programmes.length > 0) item.programmes = programmes;
  if (blockedBy && blockedBy.length > 0) item.blockedBy = blockedBy;
  for (const key of [
    "href",
    "works",
    "gap",
    "evidence",
    "verifiedAt",
    "droppedAt",
    "droppedReason",
  ] as const) {
    const v = str(value[key], `${label}.${key}`, errors, { required: false });
    if (v !== undefined) item[key] = v;
  }
  if (provenance) item.provenance = provenance;
  if (tags && tags.length > 0) item.tags = tags;

  return item;
}

function parsePhase(value: unknown, path: string, errors: Errors): Phase | undefined {
  if (!isRecord(value)) {
    errors.add(`${path} must be an object`);
    return undefined;
  }
  const key = str(value.key, `${path}.key`, errors);
  const label = str(value.label, `${path}.label`, errors);
  const state = oneOf(value.state, PHASE_STATES, `${path}.state`, errors);
  if (key === undefined || label === undefined || state === undefined) return undefined;

  const phase: Phase = { key, label, state };
  const shippedAt = str(value.shippedAt, `${path}.shippedAt`, errors, { required: false });
  if (shippedAt !== undefined) phase.shippedAt = shippedAt;
  const evidence = str(value.evidence, `${path}.evidence`, errors, { required: false });
  if (evidence !== undefined) phase.evidence = evidence;
  return phase;
}

function parseProgramme(value: unknown, index: number, errors: Errors): Programme | undefined {
  const path = `programmes[${index}]`;
  if (!isRecord(value)) {
    errors.add(`${path} must be an object`);
    return undefined;
  }
  const id = str(value.id, `${path}.id`, errors);
  const label = str(value.label, `${path}.label`, errors);
  const standing = oneOf(value.standing, STANDINGS, `${path}.standing`, errors);
  const caveat = str(value.caveat, `${path}.caveat`, errors);
  const source = str(value.source, `${path}.source`, errors);

  let phases: Phase[] = [];
  if (!Array.isArray(value.phases)) {
    errors.add(`${path}.phases must be an array`);
  } else {
    phases = value.phases
      .map((p, i) => parsePhase(p, `${path}.phases[${i}]`, errors))
      .filter((p): p is Phase => p !== undefined);
    const seen = new Set<string>();
    for (const phase of phases) {
      if (seen.has(phase.key)) errors.add(`${path} has duplicate phase key "${phase.key}"`);
      seen.add(phase.key);
    }
  }

  if (
    id === undefined ||
    label === undefined ||
    standing === undefined ||
    caveat === undefined ||
    source === undefined
  ) {
    return undefined;
  }
  return { id, label, standing, caveat, source, phases };
}

function parsePrinciple(value: unknown, index: number, errors: Errors): Principle | undefined {
  const path = `principles[${index}]`;
  if (!isRecord(value)) {
    errors.add(`${path} must be an object`);
    return undefined;
  }
  const id = str(value.id, `${path}.id`, errors);
  const title = str(value.title, `${path}.title`, errors);
  const body = str(value.body, `${path}.body`, errors);
  // Required, not optional: a principle with no source in this repo would be one
  // we invented, which is the thing the principles themselves forbid.
  const source = str(value.source, `${path}.source`, errors);
  if (id === undefined || title === undefined || body === undefined || source === undefined) {
    return undefined;
  }
  return { id, title, body, source };
}

function parseMission(value: unknown, errors: Errors): Mission | undefined {
  if (!isRecord(value)) {
    errors.add("mission must be an object");
    return undefined;
  }
  const northStar = str(value.northStar, "mission.northStar", errors);
  const statement = str(value.statement, "mission.statement", errors);
  const source = str(value.source, "mission.source", errors);
  if (northStar === undefined || statement === undefined || source === undefined) return undefined;
  return { northStar, statement, source };
}

function parseMeta(value: unknown, errors: Errors): TrackerMeta | undefined {
  if (!isRecord(value)) {
    errors.add("meta must be an object");
    return undefined;
  }
  const seededFrom = strArray(value.seededFrom, "meta.seededFrom", errors) ?? [];
  const seededAt = str(value.seededAt, "meta.seededAt", errors);
  const lastEditedAt =
    str(value.lastEditedAt, "meta.lastEditedAt", errors, { required: false }) ?? null;
  const lastEditedBy =
    value.lastEditedBy === null || value.lastEditedBy === undefined
      ? null
      : (oneOf(value.lastEditedBy, AUTHORS, "meta.lastEditedBy", errors) ?? null);
  if (seededAt === undefined) return undefined;
  return { seededFrom, seededAt, lastEditedAt, lastEditedBy };
}

/**
 * Validates an untrusted value — parsed JSON from disk, or the output of a
 * mutation — into a `TrackerDoc`. Never throws; callers get every problem at once.
 */
export function parseTracker(value: unknown): ParseResult {
  const errors = new Errors();

  if (!isRecord(value)) {
    return { ok: false, errors: ["the tracker document must be a JSON object"] };
  }

  const meta = parseMeta(value.meta, errors);
  const mission = parseMission(value.mission, errors);

  let principles: Principle[] = [];
  if (Array.isArray(value.principles)) {
    principles = value.principles
      .map((p, i) => parsePrinciple(p, i, errors))
      .filter((p): p is Principle => p !== undefined);
  } else {
    errors.add("principles must be an array");
  }

  let programmes: Programme[] = [];
  if (Array.isArray(value.programmes)) {
    programmes = value.programmes
      .map((p, i) => parseProgramme(p, i, errors))
      .filter((p): p is Programme => p !== undefined);
  } else {
    errors.add("programmes must be an array");
  }

  let items: TrackedItem[] = [];
  if (Array.isArray(value.items)) {
    items = value.items
      .map((it, i) => parseItem(it, i, errors))
      .filter((it): it is TrackedItem => it !== undefined);
  } else {
    errors.add("items must be an array");
  }

  // ---- cross-references, checked only once every element parsed individually

  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) {
      errors.add(`duplicate item id "${item.id}" — ids are identity and must be unique`);
    }
    itemIds.add(item.id);
  }

  const programmeIds = new Set<string>();
  for (const programme of programmes) {
    if (programmeIds.has(programme.id)) errors.add(`duplicate programme id "${programme.id}"`);
    programmeIds.add(programme.id);
  }

  const principleIds = new Set<string>();
  for (const principle of principles) {
    if (principleIds.has(principle.id)) errors.add(`duplicate principle id "${principle.id}"`);
    principleIds.add(principle.id);
  }

  for (const item of items) {
    for (const blocker of item.blockedBy ?? []) {
      // An `ext:` blocker is free text by design — an external dependency has no
      // id to point at. Anything else must resolve, because a blocker pointing at
      // nothing reads as tracked and is not.
      if (isExternalBlocker(blocker)) continue;
      if (!itemIds.has(blocker)) {
        errors.add(
          `items[${item.id}].blockedBy references unknown item "${blocker}" — use the "ext:" prefix for a blocker outside the tracker`
        );
      }
    }
    for (const ref of item.programmes ?? []) {
      const programme = programmes.find((p) => p.id === ref.programme);
      if (!programme) {
        errors.add(`items[${item.id}].programmes references unknown programme "${ref.programme}"`);
        continue;
      }
      if (!programme.phases.some((p) => p.key === ref.phase)) {
        errors.add(
          `items[${item.id}].programmes references unknown phase "${ref.phase}" in programme "${ref.programme}"`
        );
      }
    }
  }

  if (errors.list.length > 0) return { ok: false, errors: errors.list };
  if (meta === undefined || mission === undefined) {
    return { ok: false, errors: ["the tracker document is missing meta or mission"] };
  }

  return { ok: true, doc: { meta, mission, principles, programmes, items } };
}

// ------------------------------------------------------------- serialisation

/**
 * Key order for every object we write. Fixed deliberately: `JSON.stringify`
 * preserves insertion order, so rebuilding each object in a known order is what
 * keeps a one-field edit to a one-line diff instead of reshuffling the file.
 */
function orderedItem(item: TrackedItem): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: item.id,
    title: item.title,
    lane: item.lane,
    area: item.area,
    level: item.level,
    state: item.state,
    importance: item.importance,
    rank: item.rank,
  };
  if (item.programmes?.length) {
    out.programmes = item.programmes.map((p) => ({ programme: p.programme, phase: p.phase }));
  }
  if (item.blockedBy?.length) out.blockedBy = item.blockedBy;
  if (item.href !== undefined) out.href = item.href;
  if (item.works !== undefined) out.works = item.works;
  if (item.gap !== undefined) out.gap = item.gap;
  if (item.evidence !== undefined) out.evidence = item.evidence;
  if (item.provenance) {
    const p: Record<string, unknown> = {};
    if (item.provenance.doc !== undefined) p.doc = item.provenance.doc;
    if (item.provenance.commit !== undefined) p.commit = item.provenance.commit;
    if (item.provenance.session !== undefined) p.session = item.provenance.session;
    if (item.provenance.note !== undefined) p.note = item.provenance.note;
    out.provenance = p;
  }
  out.origin = item.origin;
  out.addedAt = item.addedAt;
  out.addedBy = item.addedBy;
  if (item.verifiedAt !== undefined) out.verifiedAt = item.verifiedAt;
  if (item.droppedAt !== undefined) out.droppedAt = item.droppedAt;
  if (item.droppedReason !== undefined) out.droppedReason = item.droppedReason;
  if (item.tags?.length) out.tags = item.tags;
  return out;
}

function orderedProgramme(programme: Programme): Record<string, unknown> {
  return {
    id: programme.id,
    label: programme.label,
    standing: programme.standing,
    caveat: programme.caveat,
    source: programme.source,
    phases: programme.phases.map((phase) => {
      const out: Record<string, unknown> = {
        key: phase.key,
        label: phase.label,
        state: phase.state,
      };
      if (phase.shippedAt !== undefined) out.shippedAt = phase.shippedAt;
      if (phase.evidence !== undefined) out.evidence = phase.evidence;
      return out;
    }),
  };
}

/** Writes the document as JSON with stable key order, two-space indent and a
 *  trailing newline. Byte-identical for an unchanged document. */
export function serializeTracker(doc: TrackerDoc): string {
  const ordered = {
    meta: {
      seededFrom: doc.meta.seededFrom,
      seededAt: doc.meta.seededAt,
      lastEditedAt: doc.meta.lastEditedAt,
      lastEditedBy: doc.meta.lastEditedBy,
    },
    mission: {
      northStar: doc.mission.northStar,
      statement: doc.mission.statement,
      source: doc.mission.source,
    },
    principles: doc.principles.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      source: p.source,
    })),
    programmes: doc.programmes.map(orderedProgramme),
    items: doc.items.map(orderedItem),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
