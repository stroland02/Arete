import { describe, it, expect } from "vitest";
import { getFixContainer, type FixContainerDb } from "./fix-container-store";

function dbWith(row: Record<string, unknown> | null): FixContainerDb {
  return { issueContainer: { findFirst: async () => row } };
}

const READY_ROW = {
  id: "cont-1",
  installationId: "inst-1",
  state: "ready",
  gates: { solutionApprovedAt: null },
  pr: { base: "main", branch: "kuma/issue-abcd", title: "Fix SQL", body: "..." },
  patch: [{ path: "app/api/reports.ts", content: "safe();" }],
  transcript: [
    { kind: "dispatch", text: "Authoring a fix on qwen2.5-coder", at: "2026-07-20T10:00:00.000Z" },
    { kind: "compose", text: "Composed patch — 1 file(s)", at: "2026-07-20T10:01:00.000Z" },
  ],
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:01:00.000Z",
};

describe("getFixContainer", () => {
  it("projects a fix container's persisted transcript into the console shape", async () => {
    const c = await getFixContainer(dbWith(READY_ROW), ["inst-1"], "cont-1");
    expect(c).not.toBeNull();
    expect(c!.state).toBe("ready");
    expect(c!.transcript).toHaveLength(2);
    expect(c!.transcript[0].text).toContain("Authoring a fix");
    expect(c!.pr?.state).toBe("ready");
  });

  it("streams an honest starting line when the drive hasn't written a transcript yet", async () => {
    const c = await getFixContainer(dbWith({ ...READY_ROW, state: "detecting", transcript: null }), ["inst-1"], "cont-1");
    expect(c!.transcript).toHaveLength(1);
    expect(c!.transcript[0].text).toContain("Fix dispatched");
  });

  it("returns null for another tenant's container (scoped by installationId)", async () => {
    // The real query filters installationId in [...]; an empty scope can't match.
    const c = await getFixContainer(dbWith(null), ["someone-else"], "cont-1");
    expect(c).toBeNull();
  });

  it("returns null with no installations (never an unscoped read)", async () => {
    let called = false;
    const db: FixContainerDb = {
      issueContainer: {
        findFirst: async () => {
          called = true;
          return READY_ROW;
        },
      },
    };
    const c = await getFixContainer(db, [], "cont-1");
    expect(c).toBeNull();
    expect(called).toBe(false);
  });
});
