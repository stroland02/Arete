/**
 * Tests for the lane checker.
 *
 * This script is what stops four agents editing each other's files and
 * rebuilding each other's work, and until now its error paths had only ever
 * been proven by hand against a scratch fixture. A check that enforces
 * discipline on everyone else and has no test of its own is exactly the kind of
 * thing it exists to catch.
 *
 * `node --test scripts/` — no runner, no config, no dependency. The pure
 * functions take their inputs as arguments, so none of this touches disk or git.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkEmptyClaims,
  checkHeartbeats,
  checkOverlap,
  checkQueue,
  checkShipped,
  checkTrespass,
  detectLane,
  globToRegExp,
  ownedFiles,
} from "./lanes.mjs";

const lane = (id, owns = [], extra = {}) => ({ id, owns, queue: [], ...extra });
const errors = (problems) => problems.filter((p) => p.level === "error");
const warnings = (problems) => problems.filter((p) => p.level === "warn");

describe("globToRegExp", () => {
  it("matches a subtree and its own root through **/", () => {
    const re = globToRegExp("packages/**/mcp/*.py");
    assert.ok(re.test("packages/agents/src/mcp/auth.py"));
    assert.ok(re.test("packages/mcp/auth.py"), "a claim on a subtree includes its root");
  });

  it("stops a single * at the path separator", () => {
    const re = globToRegExp("packages/*/index.ts");
    assert.ok(re.test("packages/db/index.ts"));
    assert.ok(!re.test("packages/db/src/index.ts"), "* must not cross a directory boundary");
  });

  it("escapes regex metacharacters in real paths", () => {
    // Not hypothetical: A-view's claim is on
    // packages/dashboard/src/app/(dashboard)/build-status/page.tsx. Unescaped,
    // those parentheses become a capture group and the claim silently matches a
    // different set of files — a lane would appear to own files it does not.
    const re = globToRegExp("packages/dashboard/src/app/(dashboard)/build-status/page.tsx");
    assert.ok(re.test("packages/dashboard/src/app/(dashboard)/build-status/page.tsx"));
    assert.ok(!re.test("packages/dashboard/src/app/dashboard/build-status/page.tsx"));
  });

  it("anchors at both ends", () => {
    const re = globToRegExp("scripts/lanes.mjs");
    assert.ok(!re.test("other/scripts/lanes.mjs"));
    assert.ok(!re.test("scripts/lanes.mjs.bak"));
  });

  it("treats a trailing ** as any depth", () => {
    const re = globToRegExp("infra/**");
    assert.ok(re.test("infra/docker-compose.yml"));
    assert.ok(re.test("infra/rules/a/b.yml"));
  });
});

describe("ownedFiles", () => {
  const files = ["a/one.ts", "a/two.ts", "b/three.ts"];

  it("resolves claims against real files rather than comparing glob strings", () => {
    assert.deepEqual([...ownedFiles(lane("x", ["a/**"]), files)], ["a/one.ts", "a/two.ts"]);
  });

  it("returns nothing for a lane that claims nothing", () => {
    assert.equal(ownedFiles(lane("x"), files).size, 0);
  });
});

describe("checkOverlap", () => {
  const files = ["shared.ts", "mine.ts"];

  it("is an error when two lanes claim one file", () => {
    // The failure that produced four duplicate commits. Two patterns that look
    // nothing alike still collide once resolved against the tree, which is why
    // this compares file sets and not strings.
    const problems = checkOverlap(
      { lanes: [lane("A", ["shared.ts"]), lane("B", ["*.ts"])] },
      files
    );
    assert.equal(errors(problems).length, 1);
    assert.match(errors(problems)[0].text, /A and B both claim/);
    assert.match(errors(problems)[0].text, /shared\.ts/);
  });

  it("is silent when claims are disjoint", () => {
    assert.deepEqual(
      checkOverlap({ lanes: [lane("A", ["shared.ts"]), lane("B", ["mine.ts"])] }, files),
      []
    );
  });

  it("compares every pair, not just adjacent ones", () => {
    const problems = checkOverlap(
      { lanes: [lane("A", ["shared.ts"]), lane("B", ["mine.ts"]), lane("C", ["shared.ts"])] },
      files
    );
    assert.equal(errors(problems).length, 1);
    assert.match(errors(problems)[0].text, /A and C/);
  });
});

describe("checkEmptyClaims", () => {
  it("warns about a claim that matches nothing real", () => {
    const problems = checkEmptyClaims({ lanes: [lane("A", ["does/not/exist/**"])] }, ["a.ts"]);
    assert.equal(warnings(problems).length, 1);
    assert.match(problems[0].text, /matches no tracked file/);
  });

  it("is a warning, not an error — a lane may claim a directory before creating it", () => {
    const problems = checkEmptyClaims({ lanes: [lane("A", ["new/**"])] }, ["a.ts"]);
    assert.equal(errors(problems).length, 0);
  });
});

describe("checkTrespass", () => {
  const files = ["mine.ts", "theirs.ts", "AGENTS.md", "loose.ts"];
  const doc = {
    shared: ["AGENTS.md", ".claude/skills/**"],
    lanes: [lane("A", ["mine.ts"]), lane("B", ["theirs.ts"])],
  };
  const changed = (...paths) => () => new Set(paths);

  it("is an error to change a file another lane owns", () => {
    const problems = checkTrespass(doc, files, "A", changed("theirs.ts"));
    assert.equal(errors(problems).length, 1);
    assert.match(errors(problems)[0].text, /claimed by B/);
  });

  it("allows your own files", () => {
    assert.deepEqual(checkTrespass(doc, files, "A", changed("mine.ts")), []);
  });

  it("allows a shared file, including through a glob", () => {
    assert.deepEqual(
      checkTrespass(doc, files, "A", changed("AGENTS.md", ".claude/skills/x/SKILL.md")),
      []
    );
  });

  it("warns rather than errors on a file nobody claims", () => {
    // Unclaimed is not someone else's. It needs claiming, but erroring would
    // make the first edit to any new file a hard failure.
    const problems = checkTrespass(doc, files, "A", changed("loose.ts"));
    assert.equal(errors(problems).length, 0);
    assert.equal(warnings(problems).length, 1);
    assert.match(problems[0].text, /claimed by no lane/);
  });

  it("says so when the checkout matches no lane, instead of guessing one", () => {
    const problems = checkTrespass(doc, files, "nonexistent-lane", changed("theirs.ts"));
    assert.equal(errors(problems).length, 0);
    assert.match(problems[0].text, /matches no lane/);
  });
});

describe("checkQueue", () => {
  const tracker = {
    items: [
      { id: "open-item", state: "next" },
      { id: "done-item", state: "shipped" },
      { id: "gone-item", state: "dropped", droppedReason: "superseded" },
    ],
  };

  it("is an error to queue something another lane already shipped", () => {
    // The check that earned its keep on day one: C-data had silence-a-finding
    // queued while ridley shipped it. Caught before C-data had started.
    const problems = checkQueue({ lanes: [lane("A", [], { queue: ["done-item"] })] }, tracker);
    assert.equal(errors(problems).length, 1);
    assert.match(errors(problems)[0].text, /already calls it shipped/);
  });

  it("is an error to queue an id no tracker item has", () => {
    const problems = checkQueue({ lanes: [lane("A", [], { queue: ["typo"] })] }, tracker);
    assert.equal(errors(problems).length, 1);
    assert.match(errors(problems)[0].text, /no tracker item has that id/);
  });

  it("is an error for two lanes to queue the same id", () => {
    const problems = checkQueue(
      {
        lanes: [
          lane("A", [], { queue: ["open-item"] }),
          lane("B", [], { queue: ["open-item"] }),
        ],
      },
      tracker
    );
    assert.equal(errors(problems).length, 1);
    assert.match(errors(problems)[0].text, /about to waste a day/);
  });

  it("warns, with the reason, about a dropped item", () => {
    const problems = checkQueue({ lanes: [lane("A", [], { queue: ["gone-item"] })] }, tracker);
    assert.equal(errors(problems).length, 0);
    assert.match(problems[0].text, /superseded/);
  });

  it("is silent on an ordinary open item", () => {
    assert.deepEqual(checkQueue({ lanes: [lane("A", [], { queue: ["open-item"] })] }, tracker), []);
  });
});

describe("checkHeartbeats", () => {
  const now = Date.parse("2026-07-23T12:00:00Z");

  it("is silent for a lane seen recently", () => {
    const doc = { lanes: [lane("A", [], { heartbeat: "2026-07-23T11:30:00Z" })] };
    assert.deepEqual(checkHeartbeats(doc, now), []);
  });

  it("warns once a lane has been quiet past the threshold", () => {
    const doc = { lanes: [lane("A", [], { heartbeat: "2026-07-23T02:00:00Z" })] };
    const problems = checkHeartbeats(doc, now);
    assert.equal(warnings(problems).length, 1);
    assert.match(problems[0].text, /10\.0h ago/);
  });

  it("warns about a lane that has never checked in", () => {
    assert.match(checkHeartbeats({ lanes: [lane("A")] }, now)[0].text, /never checked in/);
  });

  it("warns rather than throwing on an unparseable heartbeat", () => {
    // A malformed timestamp must not take the whole check down; this is the
    // thing everyone else runs before they push.
    const doc = { lanes: [lane("A", [], { heartbeat: "yesterday-ish" })] };
    assert.match(checkHeartbeats(doc, now)[0].text, /unparseable/);
  });
});

describe("detectLane", () => {
  it("never matches a lane with no checkout", () => {
    // `"anything".endsWith("")` is true, so an empty or null checkout would
    // claim whichever lane happened to be listed first — and the verify lane
    // deliberately has none.
    const doc = {
      lanes: [
        { id: "no-checkout", checkout: null, owns: [] },
        { id: "also-none", checkout: "", owns: [] },
      ],
    };
    assert.equal(detectLane(doc), undefined);
  });
});

describe("checkShipped — shipped must be provable, not assertable", () => {
  const tracker = (items) => ({ items });
  const onMain = () => true;
  const notOnMain = () => false;
  const errors = (ps) => ps.filter((p) => p.level === "error");
  const warnings = (ps) => ps.filter((p) => p.level === "warn");

  it("is an ERROR when a shipped row's commit is not on main", () => {
    // The exact failure the review named: a row shipped for work that never
    // merged, so the product advertises a capability it lacks and nobody looks
    // again. This is the whole reason the check exists.
    const ps = checkShipped({}, tracker([{ id: "x", state: "shipped", shippedIn: "deadbeef" }]), notOnMain);
    assert.equal(errors(ps).length, 1);
    assert.match(errors(ps)[0].text, /NOT on main/);
  });

  it("is silent for a shipped row whose commit IS on main", () => {
    const ps = checkShipped({}, tracker([{ id: "x", state: "shipped", shippedIn: "63479fd" }]), onMain);
    assert.deepEqual(ps, []);
  });

  it("summarises unproven shipped rows into ONE warning, not one per row", () => {
    // 26 identical warnings would bury every other signal — that is its own
    // dishonesty. The count is the signal; three ids are a sample.
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, state: "shipped" }));
    const ps = checkShipped({}, tracker(items), onMain);
    assert.equal(warnings(ps).length, 1);
    assert.equal(errors(ps).length, 0);
    assert.match(warnings(ps)[0].text, /5 shipped row/);
  });

  it("ignores rows that are not shipped", () => {
    const ps = checkShipped({}, tracker([
      { id: "a", state: "next" },
      { id: "b", state: "dropped" },
    ]), notOnMain);
    assert.deepEqual(ps, []);
  });

  it("treats an unresolvable shippedIn as unproven, via the real git default returning false", () => {
    // A garbage ref cannot prove anything; "cannot prove" is the failing case.
    const ps = checkShipped({}, tracker([{ id: "x", state: "shipped", shippedIn: "not-a-real-ref-xyz" }]), () => false);
    assert.equal(errors(ps).length, 1);
  });
});
