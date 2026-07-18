import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TriageBar } from "./triage-bar";

describe("TriageBar", () => {
  it("labels the three buckets", () => {
    const html = renderToStaticMarkup(
      <TriageBar counts={{ awaiting: 2, inFlight: 3, blocked: 1 }} />
    );
    expect(html).toContain("Awaiting approval");
    expect(html).toContain("In flight");
    expect(html).toContain("Blocked");
  });
  it("renders honest zeros (does not hide empty buckets)", () => {
    const html = renderToStaticMarkup(
      <TriageBar counts={{ awaiting: 0, inFlight: 0, blocked: 0 }} />
    );
    expect(html).toContain("Awaiting approval");
    expect(html).toMatch(/nothing waiting on you/i);
  });
});
