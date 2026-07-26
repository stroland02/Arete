import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The dock mounts globally over the whole app. Its regression-critical property
// (QA bug 1): the fixed wrapper must be `pointer-events-none` so its transparent
// extents never swallow clicks on page controls beneath it (e.g. the /agents
// composer Send button); only the visible panel re-enables pointer events.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { GlassBoxDock } from "./glassbox-dock";

describe("GlassBoxDock", () => {
  it("renders nothing when no SSE url is configured (inert in prod)", () => {
    expect(renderToStaticMarkup(<GlassBoxDock url="" />)).toBe("");
  });

  it("makes the fixed wrapper click-through and only the panel interactive", () => {
    const html = renderToStaticMarkup(
      <GlassBoxDock url="http://localhost:4517/glassbox/stream" />
    );
    expect(html).toContain('data-testid="glassbox-dock"');
    // wrapper is click-through so elementFromPoint returns page controls beneath
    expect(html).toContain("pointer-events-none");
    // the visible panel re-enables pointer events
    expect(html).toContain("pointer-events-auto");
  });
});
