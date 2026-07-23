import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { TRACKER_PATH, nextRank, type Tracker, type TrackerItem } from "@/lib/build-tracker";

/**
 * Dev-only write-back for the master build tracker.
 *
 * The tracker stays a hand-authored JSON file (`data/build-tracker.json`) —
 * that is deliberate, so it can describe capabilities with no UI to inspect,
 * and so every edit lands as a reviewable git diff rather than invisible
 * database state.
 *
 * Editing JSON rather than a TypeScript literal means add-then-remove restores
 * the file byte for byte; the only care needed is line endings, which git
 * checks out as CRLF on Windows.
 *
 * Not mounted in production — editing your own source at runtime is a
 * local-development affordance only. Note this route also sits behind the
 * session gate in `proxy.ts`, so it is never anonymously reachable either.
 */

const LANES = ["inventory", "idea"];
const LEVELS = ["live", "preview", "partial", "soon"];
const STATES = ["shipped", "next", "blocked", "someday", "needs-decision"];
const IMPORTANCES = ["critical", "high", "medium", "low"];
const AREAS = ["Product surfaces", "Built, but unreachable", "Partially wired", "Not built yet"];

function isProduction() {
  return process.env.NODE_ENV === "production";
}

/** Preserve the file's existing line endings; git checks this out as CRLF. */
function serialize(tracker: Tracker, eol: string): string {
  return JSON.stringify(tracker, null, 2).replace(/\n/g, eol) + eol;
}

function eolOf(source: string) {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

async function read(): Promise<{ raw: string; tracker: Tracker; eol: string; hash: string }> {
  const raw = await readFile(TRACKER_PATH, "utf8");
  return { raw, tracker: JSON.parse(raw) as Tracker, eol: eolOf(raw), hash: hashOf(raw) };
}

/**
 * Fingerprint of the file as it was read.
 *
 * Every write here is read-modify-write on one JSON file, and today three
 * autonomous loops plus their agents edit it. Without this, the last writer
 * silently erases everything the others added between their read and their
 * write — and because each write is a whole-file replacement, the loss is total
 * rather than partial, and leaves no conflict for anyone to notice.
 */
function hashOf(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Refuse the write when the file moved under the caller.
 *
 * `expectedHash` is optional: a caller that does not send one is trusted, which
 * keeps curl and existing clients working. A caller that DOES send one is
 * promising it read that exact byte sequence, and we hold it to that.
 */
function staleWrite(expected: string | null | undefined, actual: string) {
  if (!expected || expected === actual) return null;
  return NextResponse.json(
    {
      error:
        "The tracker changed on disk since this page loaded — reload and reapply your edit.",
      expected,
      actual,
    },
    { status: 409 }
  );
}

function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function POST(request: Request) {
  if (isProduction()) return new NextResponse("Not found", { status: 404 });

  // `expectedHash` is transport, not part of the stored item — see hashOf().
  let body: Partial<TrackerItem> & { expectedHash?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "A title is required." }, { status: 400 });

  const checks: [string, string | undefined, string[]][] = [
    ["lane", body.lane, LANES],
    ["level", body.level, LEVELS],
    ["state", body.state, STATES],
    ["importance", body.importance, IMPORTANCES],
    ["area", body.area, AREAS],
  ];
  for (const [field, value, allowed] of checks) {
    if (!value || !allowed.includes(value)) {
      return NextResponse.json(
        { error: `${field} must be one of: ${allowed.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // Where the idea came from. Required for anything an agent files, because a
  // catalogue entry nobody can trace is an assertion the reader cannot check —
  // and the whole point of this tracker is that every claim on it is checkable.
  // `origin: "user"` is the one exemption: a person adding their own idea owes
  // no citation.
  const origin = body.origin === "user" ? "user" : "session";
  const provenance = body.provenance;
  // Read as a loose record on purpose. The stored data uses `doc` (85 rows) and
  // `note` (69 rows), while the declared type in lib/build-tracker.ts is
  // `{ doc?; session? }` — so `note` is invisible to the compiler and `session`
  // is used by nothing. That type is Lane B's to reconcile; accepting any
  // non-empty field here means this guard cannot be defeated by the mismatch.
  const hasProvenance =
    !!provenance &&
    Object.values(provenance as Record<string, unknown>).some(
      (v) => typeof v === "string" && v.trim().length > 0
    );
  if (origin !== "user" && !hasProvenance) {
    return NextResponse.json(
      {
        error:
          "provenance is required: cite the doc, commit, session or a note explaining where this came from. Set origin:\"user\" only for an idea you are adding yourself.",
      },
      { status: 400 }
    );
  }

  const { tracker, eol, hash } = await read();
  const stale = staleWrite(body.expectedHash, hash);
  if (stale) return stale;

  const id = body.id?.trim() || slugify(title);
  if (tracker.items.some((i) => i.id === id)) {
    return NextResponse.json(
      { error: `"${id}" is already tracked. Remove it first to replace it.` },
      { status: 409 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  // verifiedAt is deliberately never set here — a new row has not been verified,
  // and the page must be able to say so truthfully.
  const item: TrackerItem = {
    id,
    title,
    lane: body.lane!,
    area: body.area!,
    level: body.level!,
    state: body.state!,
    importance: body.importance!,
    // Sparse step of 10, matching the scheme the data already uses, so an
    // insert between two rows never has to renumber the list. max+1 collided
    // with that scheme every time.
    rank: nextRank(tracker),
    ...(body.href ? { href: body.href } : {}),
    ...(body.works ? { works: body.works } : {}),
    ...(body.gap ? { gap: body.gap } : {}),
    ...(body.evidence ? { evidence: body.evidence } : {}),
    ...(hasProvenance ? { provenance } : {}),
    origin,
    addedAt: today,
    addedBy: "build-status editor",
  };

  tracker.items.push(item);
  tracker.meta.lastEditedAt = today;
  tracker.meta.lastEditedBy = "build-status editor";

  const next = serialize(tracker, eol);
  await writeFile(TRACKER_PATH, next, "utf8");
  return NextResponse.json({ ok: true, added: id, hash: hashOf(next) });
}

/** Read the current fingerprint, so a client can hold it and write safely. */
export async function GET() {
  if (isProduction()) return new NextResponse("Not found", { status: 404 });
  const { tracker, hash } = await read();
  return NextResponse.json({ hash, count: tracker.items.length });
}

/**
 * Drop an item — do not erase it.
 *
 * This used to be `items.filter(i => i.id !== id)` followed by a whole-file
 * write: one click, behind a dropdown listing all 85 rows, permanently destroyed
 * a catalogued idea with no confirmation and no undo. The catalogue exists
 * precisely so that a good idea raised in one session is not lost when that
 * session ends, so a delete button was the one control most directly opposed to
 * the point of the thing.
 *
 * Now a drop is a state, with a reason and a date. The row stays readable and
 * restorable, and `droppedItems()` can show what was set aside and why —
 * "we decided not to" is information, and deleting the row throws it away.
 *
 * The single exception is an item whose `origin` is `"user"`: something a person
 * typed in themselves and immediately wants gone (a typo, a duplicate) has no
 * institutional history worth keeping, so that is a true removal.
 */
export async function DELETE(request: Request) {
  if (isProduction()) return new NextResponse("Not found", { status: 404 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Pass ?id=<item id>." }, { status: 400 });

  const reason = url.searchParams.get("reason")?.trim();
  const { tracker, eol, hash } = await read();
  const stale = staleWrite(url.searchParams.get("expectedHash"), hash);
  if (stale) return stale;

  const item = tracker.items.find((i) => i.id === id);
  if (!item) return NextResponse.json({ error: `No item with id "${id}".` }, { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  let outcome: string;

  if (item.origin === "user") {
    // Someone's own entry, removed by the person who wrote it.
    tracker.items = tracker.items.filter((i) => i.id !== id);
    outcome = "removed";
  } else {
    if (!reason) {
      return NextResponse.json(
        {
          error:
            "Dropping a catalogued item needs a reason — pass ?reason=. A drop with no reason is not a record of a decision.",
        },
        { status: 400 }
      );
    }
    if (item.state === "dropped") {
      return NextResponse.json({ error: `"${id}" is already dropped.` }, { status: 409 });
    }
    item.state = "dropped";
    item.droppedAt = today;
    item.droppedReason = reason;
    outcome = "dropped";
  }

  tracker.meta.lastEditedAt = today;
  tracker.meta.lastEditedBy = "build-status editor";

  const next = serialize(tracker, eol);
  await writeFile(TRACKER_PATH, next, "utf8");
  return NextResponse.json({ ok: true, [outcome]: id, hash: hashOf(next) });
}
