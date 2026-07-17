import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceQaLoop, qaVerification, DEFAULT_MAX_PASSES, type QaLoopState } from "./qa.js";
import { transition } from "./status.js";

const fresh = (): QaLoopState => ({ passes: 0, maxPasses: DEFAULT_MAX_PASSES });

test("QA pass routes to synthesize and yields done-eligible verification", () => {
  const { outcome } = advanceQaLoop(fresh(), { pass: true });
  assert.equal(outcome.action, "synthesize");
  const r = transition("progress", {
    phase: "done",
    note: "qa green",
    verification: qaVerification("drove checkout"),
  });
  assert.equal(r.ok, true);
});

test("QA fail under the cap re-dispatches with the exact error", () => {
  const { state, outcome } = advanceQaLoop(fresh(), { pass: false, error: "500 on submit" });
  assert.equal(state.passes, 1);
  assert.equal(outcome.action, "redispatch");
  assert.equal(outcome.action === "redispatch" && outcome.error, "500 on submit");
});

test("QA fail at the cap escalates to the human gate, never loops", () => {
  const state = { passes: DEFAULT_MAX_PASSES - 1, maxPasses: DEFAULT_MAX_PASSES };
  const { state: next, outcome } = advanceQaLoop(state, { pass: false, error: "still broken" });
  assert.equal(next.passes, DEFAULT_MAX_PASSES);
  assert.equal(outcome.action, "escalate-human");
});
