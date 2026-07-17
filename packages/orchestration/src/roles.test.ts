import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLE_CAPABILITIES, can } from "./roles.js";

test("orchestrator can dispatch and gate", () => {
  assert.equal(can("orchestrator", "canDispatch"), true);
  assert.equal(can("orchestrator", "canGate"), true);
});

test("worker can report but not dispatch or gate", () => {
  assert.equal(can("worker", "canReport"), true);
  assert.equal(can("worker", "canDispatch"), false);
  assert.equal(can("worker", "canGate"), false);
});

test("integrator can gate and report", () => {
  assert.equal(can("integrator", "canGate"), true);
  assert.equal(can("integrator", "canReport"), true);
});

test("capability matrix covers exactly the three roles", () => {
  assert.deepEqual(Object.keys(ROLE_CAPABILITIES).sort(), ["integrator", "orchestrator", "worker"]);
});
