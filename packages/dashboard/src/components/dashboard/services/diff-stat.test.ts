import { describe, it, expect } from "vitest";
import { diffStat, patchText } from "./diff-stat";
import type { DiffRow } from "./services-workspace";

const rows: DiffRow[] = [
  { kind: "context", text: "function f() {" },
  { kind: "remove", text: "  return 1" },
  { kind: "add", text: "  return 2" },
  { kind: "add", text: "  // note" },
];

describe("diffStat", () => {
  it("counts adds and removes", () => {
    expect(diffStat(rows)).toEqual({ added: 2, removed: 1 });
  });
});
describe("patchText", () => {
  it("prefixes +/-/space and heads with the file", () => {
    expect(patchText("a.ts", rows)).toBe(
      "--- a.ts\n function f() {\n-  return 1\n+  return 2\n+  // note"
    );
  });
});
