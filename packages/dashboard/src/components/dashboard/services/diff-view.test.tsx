import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffView } from "./diff-view";
import type { DiffRow } from "./services-workspace";

const rows: DiffRow[] = [
  { kind: "context", text: "function f() {" },
  { kind: "remove", text: "  return 1" },
  { kind: "add", text: "  return 2" },
];

describe("DiffView", () => {
  it("shows the file header and +N −M summary", () => {
    const html = renderToStaticMarkup(<DiffView file="src/a.ts" rows={rows} />);
    expect(html).toContain("src/a.ts");
    expect(html).toContain("+1");
    expect(html).toMatch(/[−-]1/); // − (minus) or - (hyphen)
  });
  it("renders a line-number gutter", () => {
    const html = renderToStaticMarkup(<DiffView file="a.ts" rows={rows} />);
    expect(html).toContain("aria-hidden"); // gutter cells are decorative
  });
});
