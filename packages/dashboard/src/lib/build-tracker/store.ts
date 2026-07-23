import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseTracker, serializeTracker } from "./parse";
import type { TrackerDoc } from "./schema";

/**
 * The only module that touches disk.
 *
 * Everything else in `lib/build-tracker` is pure, so keeping I/O in one place
 * means the whole engine stays testable — and if the tracker ever needs to move
 * behind a database, this is the single file that changes.
 *
 * Server-only: imported by the build-status page and its route handler. Never
 * import it into a client component.
 */

/** Relative to the dashboard package root, which is Next's `process.cwd()`. */
export const TRACKER_RELATIVE_PATH = path.join("data", "build-tracker.json");

function trackerPath(): string {
  return path.join(process.cwd(), TRACKER_RELATIVE_PATH);
}

export type Writability =
  | { writable: true }
  | { writable: false; reason: "production"; detail: string };

/**
 * Whether the tracker can be edited from the UI.
 *
 * Editing writes a file in the repository working tree, which a deployed
 * container does not have. Saying that plainly is not a hedge — it is the true
 * reason, and the honesty rules require a control that cannot act to be
 * disabled and to explain itself.
 */
export function trackerWritability(): Writability {
  if (process.env.NODE_ENV === "production") {
    return {
      writable: false,
      reason: "production",
      detail:
        "The tracker is a git-tracked file. Editing needs the local dev server — a deployed instance has no repository working tree to write to.",
    };
  }
  return { writable: true };
}

export type ReadResult =
  | { ok: true; doc: TrackerDoc; raw: string }
  | { ok: false; errors: string[] };

/**
 * Reads and validates the tracker.
 *
 * Returns the raw bytes alongside the document so a caller can detect that the
 * file changed underneath it — the tracker has two writers (a human in the UI
 * and an agent in an editor), and a lost update is the obvious hazard.
 */
export async function readTracker(): Promise<ReadResult> {
  let raw: string;
  try {
    raw = await readFile(trackerPath(), "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Naming the path matters: the usual cause is running from the wrong cwd,
    // and "not found" without the path sends people looking in the wrong place.
    return { ok: false, errors: [`Could not read ${TRACKER_RELATIVE_PATH}: ${detail}`] };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`${TRACKER_RELATIVE_PATH} is not valid JSON: ${detail}`] };
  }

  const parsed = parseTracker(value);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return { ok: true, doc: parsed.doc, raw };
}

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "not-writable" | "stale" | "invalid"; errors: string[] };

/**
 * Validates and writes the tracker.
 *
 * Three guards, in order, because each catches something the next cannot:
 *
 * 1. Writability — never write from a deployed instance.
 * 2. `expectedRaw` — if supplied and the file no longer matches, refuse. The
 *    second writer here is typically an agent editing the file directly, which
 *    will never cooperate with a revision counter, so the comparison is against
 *    the actual bytes.
 * 3. `parseTracker` on the RESULT — a mutation that produced an invalid document
 *    must never reach disk, or the page stops rendering entirely.
 *
 * The write itself is atomic: a temp file in the same directory, then a rename.
 * A half-written tracker would take the page down.
 */
export async function writeTracker(doc: TrackerDoc, expectedRaw?: string): Promise<WriteResult> {
  const writability = trackerWritability();
  if (!writability.writable) {
    return { ok: false, reason: "not-writable", errors: [writability.detail] };
  }

  if (expectedRaw !== undefined) {
    const current = await readTracker();
    const currentRaw = current.ok ? current.raw : undefined;
    if (currentRaw !== expectedRaw) {
      return {
        ok: false,
        reason: "stale",
        errors: [
          "The tracker changed on disk since this page loaded — most likely an agent edited it. Reload and reapply your change.",
        ],
      };
    }
  }

  const serialized = serializeTracker(doc);
  const revalidated = parseTracker(JSON.parse(serialized));
  if (!revalidated.ok) {
    return { ok: false, reason: "invalid", errors: revalidated.errors };
  }

  const target = trackerPath();
  // Same directory, so the rename stays on one filesystem and is atomic.
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, serialized, "utf8");
  await rename(temp, target);
  return { ok: true };
}
