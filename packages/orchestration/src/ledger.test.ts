import assert from "node:assert/strict";
import { test } from "node:test";
import { activeTasks, detectLaneConflicts, claimable, type TaskEntry } from "./ledger.js";

function task(over: Partial<TaskEntry>): TaskEntry {
  return {
    id: "t",
    title: "",
    owner: "w1",
    lane: { packages: [], globs: [] },
    state: "running",
    phase: "progress",
    dependsOn: [],
    ...over,
  };
}

test("activeTasks are running | review | blocked", () => {
  const entries = [
    task({ id: "a", state: "running" }),
    task({ id: "b", state: "backlog" }),
    task({ id: "c", state: "merged" }),
    task({ id: "d", state: "review" }),
    task({ id: "e", state: "blocked" }),
  ];
  assert.deepEqual(activeTasks(entries).map((t) => t.id).sort(), ["a", "d", "e"]);
});

test("detects shared-package lane conflict among active tasks", () => {
  const entries = [
    task({ id: "a", owner: "w1", lane: { packages: ["packages/dashboard"], globs: [] } }),
    task({ id: "b", owner: "w2", lane: { packages: ["packages/dashboard"], globs: [] } }),
  ];
  const c = detectLaneConflicts(entries);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].overlap.packages, ["packages/dashboard"]);
});

test("detects glob-prefix overlap", () => {
  const entries = [
    task({ id: "a", lane: { packages: [], globs: ["packages/agents/src/**"] } }),
    task({ id: "b", lane: { packages: [], globs: ["packages/agents/src/context_map/**"] } }),
  ];
  assert.equal(detectLaneConflicts(entries).length, 1);
});

test("merged/archived tasks never conflict", () => {
  const entries = [
    task({ id: "a", state: "merged", lane: { packages: ["p"], globs: [] } }),
    task({ id: "b", state: "running", lane: { packages: ["p"], globs: [] } }),
  ];
  assert.equal(detectLaneConflicts(entries).length, 0);
});

test("disjoint lanes do not conflict", () => {
  const entries = [
    task({ id: "a", lane: { packages: ["packages/webhook"], globs: [] } }),
    task({ id: "b", lane: { packages: ["packages/dashboard"], globs: [] } }),
  ];
  assert.equal(detectLaneConflicts(entries).length, 0);
});

test("claimable requires ready state and all deps merged", () => {
  const entries = [
    task({ id: "dep", state: "merged" }),
    task({ id: "open", state: "running" }),
    task({ id: "x", state: "ready", dependsOn: ["dep"] }),
    task({ id: "y", state: "ready", dependsOn: ["dep", "open"] }),
    task({ id: "z", state: "backlog", dependsOn: ["dep"] }),
  ];
  assert.equal(claimable(entries, "x"), true);
  assert.equal(claimable(entries, "y"), false); // dep "open" not merged
  assert.equal(claimable(entries, "z"), false); // not ready
});
