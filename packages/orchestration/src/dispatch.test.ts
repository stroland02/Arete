import { test } from "node:test";
import assert from "node:assert/strict";
import { planToTasks, type DispatchPlan } from "./dispatch.js";
import { detectLaneConflicts, claimable } from "./ledger.js";

const plan: DispatchPlan = {
  problemId: "ERR-42",
  analysis: "null deref in checkout",
  assignments: [
    {
      specialty: "root-cause",
      taskId: "rc",
      title: "localize",
      owner: "a",
      dependsOn: [],
      lane: { packages: ["packages/web"], globs: [] },
    },
    {
      specialty: "fix-author",
      taskId: "fix",
      title: "author fix",
      owner: "b",
      dependsOn: ["rc"],
      lane: { packages: ["packages/web"], globs: [] },
    },
  ],
};

test("planToTasks maps assignments to ready TaskEntries preserving deps + lane", () => {
  const tasks = planToTasks(plan);
  assert.equal(tasks.length, 2);
  const fix = tasks.find((t) => t.id === "fix")!;
  assert.equal(fix.state, "ready");
  assert.equal(fix.phase, null);
  assert.deepEqual(fix.dependsOn, ["rc"]);
  assert.deepEqual(fix.lane.packages, ["packages/web"]);
});

test("planToTasks output feeds lane-conflict detection + claimable gating", () => {
  const tasks = planToTasks(plan).map((t) =>
    t.id === "rc" ? { ...t, state: "running" as const } : t,
  );
  // fix depends on rc (not merged) -> not claimable yet
  assert.equal(claimable(tasks, "fix"), false);
  // two active tasks share packages/web -> conflict surfaced
  const running = tasks.map((t) => ({ ...t, state: "running" as const }));
  assert.equal(detectLaneConflicts(running).length, 1);
});
