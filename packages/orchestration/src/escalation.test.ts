import { test } from "node:test";
import assert from "node:assert/strict";
import { escalationTier } from "./escalation.js";
import type { StatusReport } from "./status-report.js";

const base: StatusReport = {
  agent: "security",
  dimension: "security",
  status: "on_track",
  summary: "clean",
  confidence: 0.9,
  blockers: [],
};
const T = 0.7; // the dashboard passes critic.DEFAULT_LOW_CONFIDENCE

test("on_track + confident → none", () => {
  assert.equal(escalationTier(base, T), "none");
});

test("done + confident → none", () => {
  assert.equal(escalationTier({ ...base, status: "done" }, T), "none");
});

test("low confidence → synth (even when on_track)", () => {
  assert.equal(escalationTier({ ...base, confidence: 0.5 }, T), "synth");
});

test("exactly at threshold → none (ladder is < threshold, matching the ⚑ flag)", () => {
  assert.equal(escalationTier({ ...base, confidence: T }, T), "none");
});

test("blocked → synth regardless of confidence", () => {
  assert.equal(escalationTier({ ...base, status: "blocked", confidence: 0.99 }, T), "synth");
});

test("needs_input → synth", () => {
  assert.equal(escalationTier({ ...base, status: "needs_input" }, T), "synth");
});

test("escalating → human (specialist explicitly hands past the synth)", () => {
  assert.equal(escalationTier({ ...base, status: "escalating" }, T), "human");
});
