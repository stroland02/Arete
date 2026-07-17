import { describe, it, expect } from "vitest";
import { narrate } from "./narrate";
import type { GlassBoxEvent } from "./types";

function ev(partial: Partial<GlassBoxEvent> & Pick<GlassBoxEvent, "kind">): GlassBoxEvent {
  return {
    id: "1",
    at: "2026-07-15T00:00:00.000Z",
    source: "system",
    title: "",
    ...partial,
  } as GlassBoxEvent;
}

describe("narrate", () => {
  it("narrates a git commit in the Synthesizer's voice with branch + short sha", () => {
    const item = narrate(
      ev({
        source: "git",
        kind: "git.commit",
        refs: { branch: "stroland02/Engineer-1", sha: "abcdef1234567890", files: ["a.ts", "b.ts"] },
        detail: "fix: retry worker backoff",
      })
    );
    expect(item.tone).toBe("success");
    expect(item.text).toContain("stroland02/Engineer-1");
    expect(item.text).toContain("abcdef1"); // short sha
    expect(item.text).toContain("2 files");
    // announces the agentic refresh
    expect(item.text.toLowerCase()).toContain("refresh");
  });

  it("narrates a branch update distinctly from a commit", () => {
    const item = narrate(
      ev({ source: "git", kind: "git.branch_updated", refs: { branch: "integration", sha: "deadbeef00" } })
    );
    expect(item.text.toLowerCase()).toContain("integration");
  });

  it("narrates the system.hello provenance banner", () => {
    const item = narrate(
      ev({
        kind: "system.hello",
        refs: { branch: "main", sha: "096d88c0", repoRoot: "C:/Users/strol/orca/Kuma/Arete" },
      })
    );
    expect(item.text.toLowerCase()).toContain("cockpit online");
    expect(item.text).toContain("main");
    expect(item.text).toContain("096d88c"); // short sha
  });

  it("narrates queue lifecycle events", () => {
    expect(narrate(ev({ source: "queue", kind: "queue.review.active", refs: { jobId: "42" } })).text)
      .toMatch(/review/i);
    const done = narrate(ev({ source: "queue", kind: "queue.review.completed", refs: { jobId: "42" } }));
    expect(done.tone).toBe("success");
    const failed = narrate(ev({ source: "queue", kind: "queue.review.failed", refs: { jobId: "42" } }));
    expect(failed.tone).toBe("error");
  });

  it("falls back to the event title for unknown kinds (never throws, never blank)", () => {
    const item = narrate(ev({ kind: "some.future.kind", title: "Something happened" }));
    expect(item.text).toBe("Something happened");
  });

  it("uses a generic phrase when an unknown kind has no title", () => {
    const item = narrate(ev({ kind: "some.future.kind", title: "" }));
    expect(item.text.length).toBeGreaterThan(0);
  });

  it("preserves the source event id and timestamp for keying/ordering", () => {
    const item = narrate(ev({ id: "99", at: "2026-07-15T12:34:56.000Z", kind: "system.hello" }));
    expect(item.id).toBe("99");
    expect(item.at).toBe("2026-07-15T12:34:56.000Z");
  });
});
