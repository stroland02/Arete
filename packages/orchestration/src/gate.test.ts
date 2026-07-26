import assert from "node:assert/strict";
import { test } from "node:test";
import { beginVerify, recordResult, merge, type GateBatch, type Approval } from "./gate.js";

const human: Approval = { by: "pm", role: "integrator", human: true };
const agent: Approval = { by: "eng2", role: "worker", human: false };

test("happy path: pending -> verifying -> verified -> merged", () => {
  let b: GateBatch = { taskIds: ["a"], state: "pending" };
  b = beginVerify(b);
  assert.equal(b.state, "verifying");
  b = recordResult(b, true);
  assert.equal(b.state, "verified");
  const r = merge(b, human);
  assert.ok("state" in r && r.state === "merged");
});

test("red result blocks the batch", () => {
  const b = recordResult({ taskIds: ["a"], state: "verifying" }, false);
  assert.equal(b.state, "blocked");
});

test("merge rejected when not verified", () => {
  const r = merge({ taskIds: ["a"], state: "verifying" }, human);
  assert.ok("ok" in r && r.ok === false);
});

test("merge rejected without human approval — no agent message is consent", () => {
  const r = merge({ taskIds: ["a"], state: "verified" }, agent);
  assert.ok("ok" in r && r.ok === false);
});
