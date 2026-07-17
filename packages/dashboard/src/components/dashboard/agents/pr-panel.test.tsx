import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PrPanel } from "./pr-panel";

const latest = { repoFullName: "acme/api", prNumber: 7, riskLevel: "high" };

describe("PrPanel — the solution gate control", () => {
  it("shows the DISABLED shell when no container is focused (nothing to approve)", () => {
    const html = renderToStaticMarkup(<PrPanel hasReviews latestReview={latest} totalFindings={2} />);
    expect(html).toContain("Approve solution");
    expect(html).toContain("disabled");
    expect(html).toContain("Open a reviewed issue to approve its solution");
  });

  it("shows the LIVE Approve control when a container is focused", () => {
    const html = renderToStaticMarkup(
      <PrPanel hasReviews latestReview={latest} totalFindings={2} containerId="sample-working" />,
    );
    expect(html).toContain("Approve solution");
    // the live control is enabled — not the disabled shell's hint
    expect(html).not.toContain("Open a reviewed issue to approve its solution");
  });

  it("always states Kuma never changes code without approval", () => {
    const html = renderToStaticMarkup(<PrPanel hasReviews latestReview={latest} totalFindings={2} />);
    expect(html).toContain("never changes your code without approval");
  });
});
