import { test } from "node:test";
import assert from "node:assert/strict";
import { isReviewDimension, validateStatusReport } from "./status-report.js";

const good = {
  agent: "security",
  dimension: "security",
  status: "on_track",
  summary: "No injection risks in the changed handlers",
  confidence: 0.92,
  blockers: [],
};

test("accepts a well-formed report", () => {
  const r = validateStatusReport(good);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.dimension, "security");
});

test("rejects an unknown dimension", () => {
  const r = validateStatusReport({ ...good, dimension: "vibes" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /dimension/);
});

test("rejects an unknown status", () => {
  assert.equal(validateStatusReport({ ...good, status: "chilling" }).ok, false);
});

test("rejects confidence outside [0,1]", () => {
  assert.equal(validateStatusReport({ ...good, confidence: 1.2 }).ok, false);
  assert.equal(validateStatusReport({ ...good, confidence: -0.1 }).ok, false);
});

test("rejects non-string blockers and empty summary", () => {
  assert.equal(validateStatusReport({ ...good, blockers: [1] }).ok, false);
  assert.equal(validateStatusReport({ ...good, summary: "" }).ok, false);
});

test("isReviewDimension narrows", () => {
  assert.equal(isReviewDimension("performance"), true);
  assert.equal(isReviewDimension("nope"), false);
});
