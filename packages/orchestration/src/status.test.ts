import assert from "node:assert/strict";
import { test } from "node:test";
import { transition, TERMINAL_PHASE, type StatusReport } from "./status.js";

const scope: StatusReport = { phase: "scope-confirmed", note: "understood" };
const prog: StatusReport = { phase: "progress", note: "building" };
const block: StatusReport = { phase: "blockers", note: "stuck" };
const doneOk: StatusReport = {
  phase: "done",
  note: "shipped",
  verification: { matrix: true, droveRealFlow: true, evidence: "matrix green + drove real flow" },
};

test("first report must be scope-confirmed", () => {
  assert.deepEqual(transition(null, scope), { ok: true, phase: "scope-confirmed" });
  assert.equal(transition(null, prog).ok, false);
});

test("progress and blockers interleave after scope-confirmed", () => {
  assert.equal(transition("scope-confirmed", prog).ok, true);
  assert.equal(transition("progress", block).ok, true);
  assert.equal(transition("blockers", prog).ok, true);
});

test("done requires full verification: matrix AND drove real flow", () => {
  assert.equal(transition("progress", doneOk).ok, true);
  const noFlow: StatusReport = { phase: "done", note: "x", verification: { matrix: true, droveRealFlow: false, evidence: "" } };
  assert.equal(transition("progress", noFlow).ok, false);
  const noVerification: StatusReport = { phase: "done", note: "x" };
  assert.equal(transition("progress", noVerification).ok, false);
});

test("done is terminal — no transition out", () => {
  assert.equal(transition("done", prog).ok, false);
  assert.equal(TERMINAL_PHASE, "done");
});
