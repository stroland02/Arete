#!/usr/bin/env node
// Prints a compact, agent-facing brief of the master build tracker.
//
// The tracker's source of truth is packages/dashboard/data/build-tracker.json.
// An agent about to plan work runs this to get the state cheaply instead of
// pulling the whole document into context: what matters next, where each
// numbering system stands, what is blocked, and how many claims nobody has
// verified. Everything here is DERIVED from the one file, so it cannot drift.
//
// Read-only. Never writes. Usage:  node scripts/build-tracker-brief.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../data/build-tracker.json", import.meta.url));

let doc;
try {
  doc = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  // An honest failure, not a blank brief that reads as "nothing to do".
  console.error(`Could not read the tracker at ${path}: ${err.message}`);
  process.exit(1);
}

const IMPORTANCE = ["critical", "high", "medium", "low"];
const CLOSED = new Set(["shipped", "dropped"]);
const isOpen = (it) => !CLOSED.has(it.state);
const byRank = (a, b) =>
  IMPORTANCE.indexOf(a.importance) - IMPORTANCE.indexOf(b.importance) || a.rank - b.rank;

const items = doc.items ?? [];
const byId = new Map(items.map((it) => [it.id, it]));

const PHASE_GLYPH = {
  done: "✓",
  "in-progress": "◐",
  "not-started": "○",
  deferred: "·",
  stale: "!",
};

function blockerLabel(b) {
  if (b.startsWith("ext:")) return b.slice(4).trim();
  const target = byId.get(b);
  return target ? `${target.title} (${target.state})` : b;
}

const out = [];
out.push(`MASTER BUILD TRACKER — seeded ${doc.meta?.seededAt ?? "?"}, ${items.length} items`);
if (doc.meta?.lastEditedAt) out.push(`last edited ${doc.meta.lastEditedAt} by ${doc.meta.lastEditedBy}`);
out.push("");

// --- Focus: the top open items across both lanes, by importance then rank
out.push("FOCUS (top open items, by importance)");
const focus = items.filter(isOpen).sort(byRank).slice(0, 8);
for (const it of focus) {
  const blockers = (it.blockedBy ?? []).map(blockerLabel);
  const tail = blockers.length ? `  <- ${blockers.join("; ")}` : "";
  const src = it.provenance?.doc ?? it.provenance?.commit ?? it.provenance?.session ?? "";
  out.push(`  [${it.importance}] ${it.id}  (${it.state})${tail}`);
  if (src) out.push(`      ${src}`);
}
out.push("");

// --- Phases: each programme on its own line, never summed together
out.push("PHASES (four numbering systems - not one sequence)");
for (const p of doc.programmes ?? []) {
  const done = p.phases.filter((ph) => ph.state === "done").length;
  const chips = p.phases.map((ph) => `${ph.key}${PHASE_GLYPH[ph.state] ?? "?"}`).join(" ");
  out.push(`  ${p.label}  [${done}/${p.phases.length}]  ${p.standing.toUpperCase()}`);
  out.push(`      ${chips}`);
  if (p.standing === "stale") out.push(`      ! ${p.caveat}`);
}
out.push("");

// --- Standing tallies
const openItems = items.filter(isOpen);
const counts = IMPORTANCE.map((imp) => `${imp} ${openItems.filter((i) => i.importance === imp).length}`);
const blocked = openItems.filter((i) => (i.blockedBy?.length ?? 0) > 0);
const needsRuling = openItems.filter((i) => i.state === "needs-decision");
const unverified = openItems.filter((i) => !i.verifiedAt);
out.push("STANDING");
out.push(`  open: ${openItems.length}  (${counts.join(", ")})`);
out.push(`  blocked: ${blocked.length}   needs a human ruling: ${needsRuling.length}`);
out.push(`  unverified claims: ${unverified.length}  (never checked against the code)`);
out.push("");
out.push("Full detail + edit: /build-status   Source: packages/dashboard/data/build-tracker.json");

console.log(out.join("\n"));
