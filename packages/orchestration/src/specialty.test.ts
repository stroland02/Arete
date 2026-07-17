import { test } from "node:test";
import assert from "node:assert/strict";
import { SPECIALTIES, type Specialty } from "./specialty.js";

test("SPECIALTIES lists the seven work-floor disciplines, unique", () => {
  assert.equal(SPECIALTIES.length, 7);
  assert.equal(new Set(SPECIALTIES).size, 7);
  const expected: Specialty[] = [
    "reproduction",
    "root-cause",
    "fix-author",
    "test-author",
    "security",
    "reviewer",
    "qa",
  ];
  for (const s of expected) assert.ok(SPECIALTIES.includes(s), `missing ${s}`);
});
