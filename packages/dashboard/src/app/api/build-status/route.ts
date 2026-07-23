import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * Dev-only write-back for the build-status list.
 *
 * The master list stays a hand-authored TypeScript file (see
 * `lib/feature-readiness.ts`) — that is deliberate, so it can describe
 * capabilities with no UI to inspect, and so every edit lands as a reviewable
 * git diff rather than invisible database state.
 *
 * This route therefore performs *surgical* inserts and removals rather than
 * re-serialising the whole array: rewriting the array wholesale would delete
 * the file's section comments and evidence annotations, which are the point of
 * it being hand-authored.
 *
 * Not mounted in production — editing your own source at runtime is a
 * local-development affordance only.
 */

const FILE = path.join(process.cwd(), "src", "lib", "feature-readiness.ts");

/**
 * Line endings are detected from the file rather than assumed. On Windows git
 * checks this file out as CRLF, and matching on a bare "\n" finds nothing —
 * every edit would fail with "file shape changed". Detecting keeps the inserted
 * text consistent with the file instead of mixing endings.
 */
function eolOf(source: string) {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

/** Closing line of the FEATURE_READINESS array literal, either line ending. */
const ARRAY_END = /\r?\n\];\r?\n/;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

interface ItemInput {
  name: string;
  area: string;
  level: string;
  priority?: string;
  phase?: string;
  href?: string;
  works?: string;
  gap?: string;
  evidence?: string;
}

const AREAS = ["Product surfaces", "Built, but unreachable", "Partially wired", "Not built yet"];
const LEVELS = ["live", "preview", "partial", "soon"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];
const PHASES = ["P1", "P2", "P2b", "P3", "P4"];

/** Render one entry as TypeScript, matching the file's existing style. */
function serialize(item: ItemInput, eol: string): string {
  const line = (k: string, v?: string) => (v ? `    ${k}: ${JSON.stringify(v)},${eol}` : "");
  return (
    `  {${eol}` +
    line("name", item.name) +
    line("area", item.area) +
    line("level", item.level) +
    line("priority", item.priority) +
    line("phase", item.phase) +
    line("href", item.href) +
    line("works", item.works) +
    line("gap", item.gap) +
    line("evidence", item.evidence) +
    `  },${eol}`
  );
}

/**
 * Find the entry whose `name` matches and return its [start, end) bounds, so it
 * can be cut out without disturbing its neighbours or the surrounding comments.
 */
function findEntry(source: string, name: string): [number, number] | null {
  const eol = eolOf(source);
  const needle = `    name: ${JSON.stringify(name)},`;
  const at = source.indexOf(needle);
  if (at === -1) return null;

  const open = `${eol}  {${eol}`;
  const start = source.lastIndexOf(open, at);
  if (start === -1) return null;

  const close = `${eol}  },${eol}`;
  const end = source.indexOf(close, at);
  if (end === -1) return null;

  return [start + eol.length, end + close.length];
}

export async function POST(request: Request) {
  if (isProduction()) return new NextResponse("Not found", { status: 404 });

  let body: ItemInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }
  if (!AREAS.includes(body.area)) {
    return NextResponse.json({ error: `area must be one of: ${AREAS.join(", ")}` }, { status: 400 });
  }
  if (!LEVELS.includes(body.level)) {
    return NextResponse.json({ error: `level must be one of: ${LEVELS.join(", ")}` }, { status: 400 });
  }
  if (body.priority && !PRIORITIES.includes(body.priority)) {
    return NextResponse.json(
      { error: `priority must be one of: ${PRIORITIES.join(", ")}` },
      { status: 400 }
    );
  }
  if (body.phase && !PHASES.includes(body.phase)) {
    return NextResponse.json({ error: `phase must be one of: ${PHASES.join(", ")}` }, { status: 400 });
  }

  const source = await readFile(FILE, "utf8");

  if (findEntry(source, body.name)) {
    return NextResponse.json(
      { error: `"${body.name}" is already on the list. Remove it first to replace it.` },
      { status: 409 }
    );
  }

  const match = ARRAY_END.exec(source);
  if (!match) {
    return NextResponse.json(
      { error: "Could not locate the end of FEATURE_READINESS — file shape changed." },
      { status: 500 }
    );
  }

  const eol = eolOf(source);
  const at = match.index + eol.length; // insert just before the closing "];"
  await writeFile(FILE, source.slice(0, at) + serialize(body, eol) + source.slice(at), "utf8");

  return NextResponse.json({ ok: true, added: body.name });
}

export async function DELETE(request: Request) {
  if (isProduction()) return new NextResponse("Not found", { status: 404 });

  const name = new URL(request.url).searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "Pass ?name=<item name>." }, { status: 400 });
  }

  const source = await readFile(FILE, "utf8");
  const bounds = findEntry(source, name);
  if (!bounds) {
    return NextResponse.json({ error: `No entry named "${name}".` }, { status: 404 });
  }

  const [start, end] = bounds;
  await writeFile(FILE, source.slice(0, start) + source.slice(end), "utf8");

  return NextResponse.json({ ok: true, removed: name });
}
