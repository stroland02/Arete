import { NextResponse } from "next/server";
import { addItem, dropItem, removeUserItem } from "@/lib/build-tracker/mutate";
import { readTracker, trackerWritability, writeTracker } from "@/lib/build-tracker/store";
import {
  AREA_ORDER,
  IMPORTANCE_ORDER,
  LEVEL_ORDER,
  type Importance,
  type ItemState,
  type ReadinessArea,
  type ReadinessLevel,
} from "@/lib/build-tracker/schema";

/**
 * Dev-only write-back for the build-status tracker.
 *
 * The tracker stays a git-tracked file (`data/build-tracker.json`) rather than
 * database state, so every edit made here arrives as a reviewable diff, and an
 * agent can read the same record the page renders.
 *
 * This route moved with the page when it adopted the tracker. Leaving it
 * pointed at the old list would have been worse than not shipping it: the form
 * would look live, report success, and write somewhere nothing reads.
 *
 * Not available in production — editing a repository working tree at runtime is
 * a local-development affordance, and a deployed container has no working tree.
 */

export const dynamic = "force-dynamic";

/** The page's importance bands, as the editor still labels them. */
const PRIORITY_TO_IMPORTANCE: Record<string, Importance> = {
  P0: "critical",
  P1: "high",
  P2: "medium",
  P3: "low",
};

/**
 * A new row's lifecycle state, inferred from how finished it is.
 *
 * Inferred rather than asked for: the editor collects what a person actually
 * knows (how finished, how much it matters), and making them also pick a
 * lifecycle state invites a guess that then reads as fact.
 */
function stateForLevel(level: ReadinessLevel): ItemState {
  if (level === "live") return "shipped";
  if (level === "partial" || level === "preview") return "in-progress";
  return "someday";
}

interface ItemInput {
  name?: string;
  area?: string;
  level?: string;
  priority?: string;
  href?: string;
  works?: string;
  gap?: string;
  evidence?: string;
  note?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function unavailable() {
  return new NextResponse("Not found", { status: 404 });
}

export async function POST(request: Request) {
  const writability = trackerWritability();
  if (!writability.writable) return unavailable();

  let body: ItemInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }
  if (!AREA_ORDER.includes(body.area as ReadinessArea)) {
    return NextResponse.json(
      { error: `area must be one of: ${AREA_ORDER.join(", ")}` },
      { status: 400 }
    );
  }
  if (!LEVEL_ORDER.includes(body.level as ReadinessLevel)) {
    return NextResponse.json(
      { error: `level must be one of: ${LEVEL_ORDER.join(", ")}` },
      { status: 400 }
    );
  }

  const importance = body.priority
    ? PRIORITY_TO_IMPORTANCE[body.priority]
    : ("medium" as Importance);
  if (!importance || !IMPORTANCE_ORDER.includes(importance)) {
    return NextResponse.json(
      { error: `priority must be one of: ${Object.keys(PRIORITY_TO_IMPORTANCE).join(", ")}` },
      { status: 400 }
    );
  }

  const tracker = await readTracker();
  if (!tracker.ok) {
    return NextResponse.json({ error: tracker.errors.join(" ") }, { status: 500 });
  }

  if (tracker.doc.items.some((item) => item.title === name)) {
    return NextResponse.json(
      { error: `"${name}" is already on the list. Remove it first to replace it.` },
      { status: 409 }
    );
  }

  const level = body.level as ReadinessLevel;
  const result = addItem(
    tracker.doc,
    {
      title: name,
      area: body.area as ReadinessArea,
      level,
      state: stateForLevel(level),
      importance,
      lane: "idea",
      href: body.href,
      works: body.works,
      gap: body.gap,
      note: body.note,
    },
    today()
  );

  if (!result.changed) {
    return NextResponse.json({ error: result.refused ?? "Nothing changed." }, { status: 400 });
  }

  // `expectedRaw` guards the lost update: the tracker's other writer is an agent
  // editing the file directly, and it will never cooperate with a revision
  // counter, so the comparison is against the bytes we actually read.
  const written = await writeTracker(result.doc, tracker.raw);
  if (!written.ok) {
    return NextResponse.json(
      { error: written.errors.join(" ") },
      { status: written.reason === "stale" ? 409 : 500 }
    );
  }

  return NextResponse.json({ ok: true, added: name });
}

export async function DELETE(request: Request) {
  const writability = trackerWritability();
  if (!writability.writable) return unavailable();

  const name = new URL(request.url).searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "Pass ?name=<item name>." }, { status: 400 });
  }

  const tracker = await readTracker();
  if (!tracker.ok) {
    return NextResponse.json({ error: tracker.errors.join(" ") }, { status: 500 });
  }

  const target = tracker.doc.items.find((item) => item.title === name);
  if (!target) {
    return NextResponse.json({ error: `No entry named "${name}".` }, { status: 404 });
  }

  /**
   * Two different operations, and the difference is the point.
   *
   * Something you added yourself is destroyed. A catalogued item is *dropped* —
   * it keeps its row, its provenance and a reason, and stays restorable.
   * Destroying a catalogued idea is exactly the loss this tracker was built to
   * prevent, so the API refuses to do it however the button is labelled.
   */
  const stamp = today();
  const result =
    target.origin === "user"
      ? removeUserItem(tracker.doc, target.id, stamp)
      : dropItem(tracker.doc, target.id, "Dropped from the build-status page.", stamp);

  if (!result.changed) {
    return NextResponse.json({ error: result.refused ?? "Nothing changed." }, { status: 409 });
  }

  const written = await writeTracker(result.doc, tracker.raw);
  if (!written.ok) {
    return NextResponse.json(
      { error: written.errors.join(" ") },
      { status: written.reason === "stale" ? 409 : 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    removed: name,
    // Said plainly so the UI cannot imply a catalogued idea was deleted when it
    // was only set aside.
    outcome: target.origin === "user" ? "deleted" : "dropped",
  });
}
