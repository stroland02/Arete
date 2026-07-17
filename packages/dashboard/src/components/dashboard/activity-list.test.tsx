import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityList } from "./activity-list";

const rows = [
  { id: "r1", repositoryName: "acme/api", prNumber: 418, createdAt: new Date().toISOString(), riskLevel: "high" },
];

describe("ActivityList (table)", () => {
  it("renders repo, PR number, and risk", () => {
    const html = renderToStaticMarkup(<ActivityList reviews={rows} />);
    expect(html).toContain("acme/api");
    expect(html).toContain("PR #418");
    expect(html).toMatch(/high/i);
  });
  it("empty → honest empty state, no fabricated rows", () => {
    const html = renderToStaticMarkup(<ActivityList reviews={[]} />);
    expect(html).toMatch(/no reviews yet/i);
    expect(html).not.toContain("PR #");
  });
});
