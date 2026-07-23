import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Renders the real page against the real committed tracker.
 *
 * The page is a server component that reads `data/build-tracker.json` from
 * disk, so rendering it here exercises the whole path — read, parse, select,
 * render — without needing a dev server or a login. That matters because the
 * repo's definition of done is "drive the real flow, not just a green test",
 * and the ports and auth callback in this environment belong to other lanes.
 *
 * The editor is a client component that calls a dev route; stubbing it keeps
 * this test about the page's own rendering, following the same pattern as
 * `incidents-workspace.test.tsx`.
 */

vi.mock("@/components/dashboard/build-status-editor", () => ({
  BuildStatusEditor: () => null,
}));

const { default: BuildStatusPage } = await import("./page");

async function render(): Promise<string> {
  const element = await BuildStatusPage();
  return renderToStaticMarkup(element);
}

describe("/build-status renders the committed tracker", () => {
  it("renders without falling back to the unreadable-tracker state", async () => {
    const html = await render();
    expect(html).not.toContain("The tracker could not be read");
    expect(html).toContain("Build status");
  });

  it("shows the whole catalogue, not just the audited surfaces", async () => {
    const html = await render();
    // The reason the swap happened: ~60 catalogued ideas were invisible before.
    expect(html).toContain("catalogued, not started");
  });

  it("renders every programme as its own rail, and says they are not one sequence", async () => {
    const html = await render();
    expect(html).toContain("numbering systems, not one sequence");
    expect(html).toContain("Phase progression");
  });

  it("marks a stale programme as stale rather than letting it read as current", async () => {
    const html = await render();
    // The product roadmap is `standing: "stale"` in the committed catalogue.
    expect(html).toContain("Stale");
  });

  it("keeps the importance bands the page has always used", async () => {
    const html = await render();
    expect(html).toContain("Blocks trust");
    expect(html).toContain("Next up");
  });

  it("states how many claims were never verified, instead of implying they were", async () => {
    const html = await render();
    expect(html).toContain("never been verified against the code");
  });

  it("names its source so a reader can go check it", async () => {
    const html = await render();
    expect(html).toContain("data/build-tracker.json");
  });
});
