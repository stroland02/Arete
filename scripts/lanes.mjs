#!/usr/bin/env node
/**
 * Lane discipline, as a check rather than a request.
 *
 * Four agents work this repo in parallel from four checkouts. The prose ledger
 * (`.claude/ade-coordination.md`) says who owns what, and it has already failed
 * twice in the ways prose always fails: it forked between worktrees so no
 * checkout could read it completely, and four duplicate commits landed anyway
 * because nothing rejected them.
 *
 * So ownership lives in `.claude/lanes.json` — one small file, in git, that a
 * script can evaluate. This is that script. It answers three questions a lane
 * cannot answer about itself:
 *
 *   1. Do any two lanes claim the same file?          (overlap)
 *   2. Am I currently editing outside my lane?        (trespass)
 *   3. Has someone already finished what I queued?    (stale queue)
 *
 * Every check resolves globs against `git ls-files` rather than comparing glob
 * strings, so the answer is about real files and cannot be fooled by two
 * patterns that look different and match the same path.
 *
 * Usage:
 *   node scripts/lanes.mjs check [--lane <id>]   validate; exit 1 on a real conflict
 *   node scripts/lanes.mjs board                 standup view: lanes, queues, what is next
 *   node scripts/lanes.mjs heartbeat [<id>]      record that this lane is alive, and where
 *   node scripts/lanes.mjs owner <path>          which lane owns a path
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Overridable so the checks can be run against a fixture. A check nobody has
// seen fail is a check nobody knows works.
const LANES_PATH = process.env.LANES_FILE
  ? resolve(process.env.LANES_FILE)
  : resolve(ROOT, ".claude/lanes.json");
const TRACKER_PATH = resolve(ROOT, "packages/dashboard/data/build-tracker.json");

/** A lane quiet for longer than this may be holding claims nobody is working on. */
const STALE_HEARTBEAT_HOURS = 6;

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * Glob to RegExp. Supports `**` (any depth), `*` (one segment), `?` (one char).
 *
 * `**` followed by a slash becomes `(?:.*\/)?` so a claim on a subtree means the
 * whole subtree including its root: `packages/**\/mcp/*.py` matches both
 * `packages/agents/mcp/auth.py` and `packages/mcp/auth.py`.
 */
export function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if ("\\^$+.()|{}[]".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

const trackedFiles = () => git("ls-files").split("\n").filter(Boolean);

/** Every tracked file a lane claims. Empty means the claim matches nothing real. */
export function ownedFiles(lane, files) {
  const patterns = (lane.owns ?? []).map(globToRegExp);
  return new Set(files.filter((f) => patterns.some((p) => p.test(f))));
}

/**
 * Files this checkout has changed relative to the upstream default branch —
 * committed, staged, unstaged and untracked alike. A trespass is a trespass
 * whether or not it has been committed; catching it only at commit time is
 * catching it after the work is already done.
 */
function changedHere() {
  let base = "origin/main";
  try {
    git("rev-parse", "--verify", "--quiet", base);
  } catch {
    base = "main";
  }
  const merged = new Set();
  for (const args of [
    ["diff", "--name-only", `${base}...HEAD`],
    ["diff", "--name-only", "HEAD"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    try {
      for (const f of git(...args).split("\n").filter(Boolean)) merged.add(f);
    } catch {
      // A checkout with no commits yet, or no upstream. Nothing to compare.
    }
  }
  return merged;
}

function loadLanes() {
  const doc = readJson(LANES_PATH);
  if (!Array.isArray(doc.lanes) || doc.lanes.length === 0) {
    throw new Error(".claude/lanes.json has no lanes — nothing to coordinate.");
  }
  return doc;
}

/** Which lane this checkout is, by matching its path against each lane's `checkout`. */
export function detectLane(doc) {
  const here = ROOT.replace(/\\/g, "/").toLowerCase();
  // A lane with no checkout (the verify lane) must not match: `endsWith("")` is
  // true for every string, so an empty checkout would claim whichever lane
  // happened to be listed first.
  return doc.lanes.find((l) => {
    const path = String(l.checkout ?? "").replace(/\\/g, "/").toLowerCase();
    return path.length > 0 && here.endsWith(path);
  });
}

// --- checks -----------------------------------------------------------------

/** Two lanes claiming one file. The failure that produced four duplicate commits. */
export function checkOverlap(doc, files) {
  const problems = [];
  const owned = doc.lanes.map((l) => [l, ownedFiles(l, files)]);
  for (let i = 0; i < owned.length; i++) {
    for (let j = i + 1; j < owned.length; j++) {
      const [a, setA] = owned[i];
      const [b, setB] = owned[j];
      const shared = [...setA].filter((f) => setB.has(f));
      if (shared.length > 0) {
        problems.push({
          level: "error",
          text:
            `${a.id} and ${b.id} both claim ${shared.length} file(s), starting with ` +
            `${shared.slice(0, 3).join(", ")}. Two owners is no owner — narrow one claim.`,
        });
      }
    }
  }
  return problems;
}

/** A claim matching no file on disk — a typo, or a path that has since moved. */
export function checkEmptyClaims(doc, files) {
  const problems = [];
  for (const lane of doc.lanes) {
    for (const pattern of lane.owns ?? []) {
      if (!files.some((f) => globToRegExp(pattern).test(f))) {
        problems.push({
          level: "warn",
          text: `${lane.id} claims "${pattern}", which matches no tracked file. Stale or mistyped.`,
        });
      }
    }
  }
  return problems;
}

/** Editing outside your own lane, right now, in this checkout. */
export function checkTrespass(doc, files, laneId, changed = changedHere) {
  const lane = laneId ? doc.lanes.find((l) => l.id === laneId) : detectLane(doc);
  if (!lane) {
    return [
      {
        level: "warn",
        text:
          "This checkout matches no lane's `checkout` path, so trespass cannot be checked. " +
          "Add it to .claude/lanes.json, or pass --lane <id>.",
      },
    ];
  }

  const mine = ownedFiles(lane, files);
  const shared = (doc.shared ?? []).map(globToRegExp);
  const others = doc.lanes.filter((l) => l.id !== lane.id).map((l) => [l, ownedFiles(l, files)]);
  const problems = [];

  for (const file of changed()) {
    if (mine.has(file) || shared.some((p) => p.test(file))) continue;
    const claimant = others.find(([, owned]) => owned.has(file));
    if (claimant) {
      problems.push({
        level: "error",
        text: `${file} is claimed by ${claimant[0].id}, and this checkout (${lane.id}) has changed it.`,
      });
    } else {
      problems.push({
        level: "warn",
        text: `${file} is changed here but claimed by no lane. Claim it, or list it under "shared".`,
      });
    }
  }
  return problems;
}

/** Work you queued that someone else already finished, or that does not exist. */
export function checkQueue(doc, trackerDoc = null) {
  let tracker = trackerDoc;
  try {
    tracker ??= readJson(TRACKER_PATH);
  } catch {
    return [{ level: "warn", text: "build-tracker.json is unreadable; queues not checked." }];
  }
  const byId = new Map(tracker.items.map((i) => [i.id, i]));
  const problems = [];

  for (const lane of doc.lanes) {
    for (const id of lane.queue ?? []) {
      const item = byId.get(id);
      if (!item) {
        problems.push({
          level: "error",
          text: `${lane.id} has "${id}" queued, but no tracker item has that id.`,
        });
      } else if (item.state === "shipped") {
        problems.push({
          level: "error",
          text: `${lane.id} has "${id}" queued — the tracker already calls it shipped. Pick again before you rebuild it.`,
        });
      } else if (item.state === "dropped") {
        problems.push({
          level: "warn",
          text: `${lane.id} has "${id}" queued, but it was dropped: ${item.droppedReason ?? "no reason recorded"}.`,
        });
      }
    }
  }

  // The same item on two queues is the duplicate-commit failure, one step earlier.
  const seen = new Map();
  for (const lane of doc.lanes) {
    for (const id of lane.queue ?? []) {
      if (seen.has(id)) {
        problems.push({
          level: "error",
          text: `"${id}" is queued by both ${seen.get(id)} and ${lane.id}. One of them is about to waste a day.`,
        });
      } else {
        seen.set(id, lane.id);
      }
    }
  }
  return problems;
}

/** A lane that has gone quiet. */
export function checkHeartbeats(doc, now) {
  const problems = [];
  for (const lane of doc.lanes) {
    if (!lane.heartbeat) {
      problems.push({ level: "warn", text: `${lane.id} has never checked in.` });
      continue;
    }
    const age = (now - Date.parse(lane.heartbeat)) / 3_600_000;
    if (Number.isNaN(age)) {
      problems.push({ level: "warn", text: `${lane.id} has an unparseable heartbeat.` });
    } else if (age > STALE_HEARTBEAT_HOURS) {
      problems.push({
        level: "warn",
        text: `${lane.id} last checked in ${age.toFixed(1)}h ago. Its claims may be stale.`,
      });
    }
  }
  return problems;
}

// --- commands ---------------------------------------------------------------

function check(laneId) {
  const doc = loadLanes();
  const files = trackedFiles();
  const problems = [
    ...checkOverlap(doc, files),
    ...checkEmptyClaims(doc, files),
    ...checkTrespass(doc, files, laneId),
    ...checkQueue(doc),
    ...checkHeartbeats(doc, Date.now()),
  ];

  const errors = problems.filter((p) => p.level === "error");
  const warnings = problems.filter((p) => p.level === "warn");

  for (const p of errors) console.error(`  ERROR  ${p.text}`);
  for (const p of warnings) console.error(`  warn   ${p.text}`);

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`lanes: ${doc.lanes.length} lanes, no conflicts.`);
  } else {
    console.error(`\nlanes: ${errors.length} error(s), ${warnings.length} warning(s).`);
  }
  return errors.length === 0 ? 0 : 1;
}

const IMPORTANCE_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function board() {
  const doc = loadLanes();
  const tracker = readJson(TRACKER_PATH);
  const byId = new Map(tracker.items.map((i) => [i.id, i]));
  const open = tracker.items.filter((i) => i.state !== "shipped" && i.state !== "dropped");
  const shipped = tracker.items.filter((i) => i.state === "shipped");

  console.log(`\n  ${tracker.mission?.northStar ?? "Kuma"}\n`);
  console.log(`  ${shipped.length} shipped · ${open.length} open · ${tracker.items.length} tracked\n`);

  const here = detectLane(doc);
  for (const lane of doc.lanes) {
    const mark = here && lane.id === here.id ? "▶" : " ";
    console.log(`${mark} ${lane.id} — ${lane.role}`);
    console.log(`    checkout  ${lane.checkout}`);
    console.log(`    owns      ${(lane.owns ?? []).join("  ") || "(nothing claimed)"}`);
    for (const id of lane.queue ?? []) {
      const item = byId.get(id);
      const state = item ? `${item.importance}/${item.state}` : "NOT IN TRACKER";
      console.log(`    -> [${state}] ${item?.title ?? id}`);
    }
    if ((lane.queue ?? []).length === 0) console.log("    -> queue empty");
    console.log(`    last seen ${lane.heartbeat ?? "never"} @ ${lane.lastCommit ?? "?"}\n`);
  }

  const queued = new Set(doc.lanes.flatMap((l) => l.queue ?? []));
  const unclaimed = open
    .filter((i) => !queued.has(i.id))
    .sort(
      (a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance] || a.rank - b.rank
    );

  console.log(`  Next up, claimed by nobody (${open.length} open in total):`);
  for (const item of unclaimed.slice(0, 8)) {
    console.log(`    ${item.importance.padEnd(8)} ${item.id.padEnd(42)} ${item.title.slice(0, 46)}`);
  }

  console.log("\n  Landed on main in the last 24h:");
  let log = "";
  try {
    log = git("log", "--since=24.hours", "--pretty=  %h %s", "origin/main");
  } catch {
    log = "    (no origin/main in this checkout)";
  }
  console.log(log || "    (nothing)");
  console.log();
  return 0;
}

function heartbeat(laneId) {
  const doc = loadLanes();
  const lane = doc.lanes.find((l) => l.id === laneId) ?? detectLane(doc);
  if (!lane) {
    console.error(`No lane "${laneId ?? "(inferred from this checkout)"}" in .claude/lanes.json.`);
    return 1;
  }
  lane.heartbeat = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  lane.lastCommit = git("rev-parse", "--short", "HEAD");
  doc.updatedAt = lane.heartbeat.slice(0, 10);
  // Two-space indent and a trailing newline: this file is reviewed as a git diff.
  writeFileSync(LANES_PATH, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`${lane.id}: ${lane.heartbeat} @ ${lane.lastCommit}`);
  return 0;
}

function owner(path) {
  if (!path) {
    console.error("Pass a path.");
    return 1;
  }
  const doc = loadLanes();
  const normalised = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if ((doc.shared ?? []).some((g) => globToRegExp(g).test(normalised))) {
    console.log(`${normalised}: shared — edit it, and say so in .claude/ade-coordination.md.`);
    return 0;
  }
  const owners = doc.lanes.filter((l) =>
    (l.owns ?? []).some((g) => globToRegExp(g).test(normalised))
  );
  if (owners.length === 0) {
    console.log(`${normalised}: unclaimed.`);
    return 0;
  }
  console.log(`${normalised}: ${owners.map((l) => l.id).join(", ")}`);
  return owners.length > 1 ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const [command = "check", ...rest] = process.argv.slice(2);
  const laneFlag = rest.indexOf("--lane");
  const laneArg = laneFlag >= 0 ? rest[laneFlag + 1] : rest[0];

  const commands = {
    check: () => check(laneFlag >= 0 ? rest[laneFlag + 1] : undefined),
    board,
    heartbeat: () => heartbeat(laneArg),
    owner: () => owner(laneArg),
  };

  const run = commands[command];
  if (!run) {
    console.error(`Unknown command "${command}". Try: check | board | heartbeat <id> | owner <path>`);
    process.exit(2);
  }
  process.exit(run());
}
