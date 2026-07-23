import { readFile, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { TRACKER_PATH, type Tracker, type TrackerItem } from "@/lib/build-tracker";

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

async function read(): Promise<{ raw: string; tracker: Tracker; eol: string }> {
  const raw = await readFile(TRACKER_PATH, "utf8");
  return { raw, tracker: JSON.parse(raw) as Tracker, eol: eolOf(raw) };
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

  let body: Partial<TrackerItem>;
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

  const { tracker, eol } = await read();

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
    rank: tracker.items.reduce((max, i) => Math.max(max, i.rank ?? 0), 0) + 1,
    ...(body.href ? { href: body.href } : {}),
    ...(body.works ? { works: body.works } : {}),
    ...(body.gap ? { gap: body.gap } : {}),
    ...(body.evidence ? { evidence: body.evidence } : {}),
    origin: "session",
    addedAt: today,
    addedBy: "build-status editor",
  };

  tracker.items.push(item);
  tracker.meta.lastEditedAt = today;
  tracker.meta.lastEditedBy = "build-status editor";

  await writeFile(TRACKER_PATH, serialize(tracker, eol), "utf8");
  return NextResponse.json({ ok: true, added: id });
}

export async function DELETE(request: Request) {
  if (isProduction()) return new NextResponse("Not found", { status: 404 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Pass ?id=<item id>." }, { status: 400 });

  const { tracker, eol } = await read();
  const before = tracker.items.length;
  tracker.items = tracker.items.filter((i) => i.id !== id);

  if (tracker.items.length === before) {
    return NextResponse.json({ error: `No item with id "${id}".` }, { status: 404 });
  }

  tracker.meta.lastEditedAt = new Date().toISOString().slice(0, 10);
  tracker.meta.lastEditedBy = "build-status editor";

  await writeFile(TRACKER_PATH, serialize(tracker, eol), "utf8");
  return NextResponse.json({ ok: true, removed: id });
}
