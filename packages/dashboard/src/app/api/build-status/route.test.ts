import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the build-tracker write path.
 *
 * This route can destroy catalogued work, so it is the one place in the feature
 * where a test is not optional. Two behaviours matter more than the rest:
 *
 *  - a drop must not erase the row, because the catalogue exists so that an idea
 *    raised once is not lost;
 *  - a write against a stale read must be refused, because three autonomous
 *    loops edit this file concurrently and each write replaces the whole file.
 *
 * The filesystem is mocked, so no real tracker is touched.
 */

const FILE = "/virtual/build-tracker.json";
let disk = "";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => disk),
  writeFile: vi.fn(async (_p: string, contents: string) => {
    disk = contents;
  }),
}));

vi.mock("@/lib/build-tracker", () => ({
  TRACKER_PATH: FILE,
  // Sparse step of 10, mirroring the real helper.
  nextRank: (t: { items: { rank?: number }[] }) =>
    t.items.reduce((m, i) => Math.max(m, i.rank ?? 0), 0) + 10,
}));

function item(over: Record<string, unknown> = {}) {
  return {
    id: "an-item",
    title: "An item",
    lane: "idea",
    area: "Not built yet",
    level: "soon",
    state: "next",
    importance: "medium",
    rank: 10,
    origin: "audit",
    addedAt: "2026-07-23",
    addedBy: "seed",
    provenance: { doc: "docs/somewhere.md" },
    ...over,
  };
}

function seed(items: Record<string, unknown>[] = [item()]) {
  disk = JSON.stringify({ meta: { lastEditedAt: null, lastEditedBy: null }, items }, null, 2);
}

const read = () => JSON.parse(disk) as { items: Record<string, unknown>[] };
const find = (id: string) => read().items.find((i) => i.id === id);

async function routes() {
  vi.stubEnv("NODE_ENV", "development");
  return await import("./route");
}

const post = (body: unknown) =>
  new Request("http://localhost/api/build-status", {
    method: "POST",
    body: JSON.stringify(body),
  });

const del = (qs: string) =>
  new Request(`http://localhost/api/build-status?${qs}`, { method: "DELETE" });

beforeEach(() => {
  vi.unstubAllEnvs();
  seed();
});

describe("DELETE — a drop is a state, not an erasure", () => {
  it("keeps the row and records why it was dropped", async () => {
    const { DELETE } = await routes();
    const res = await DELETE(del("id=an-item&reason=superseded+by+the+new+flow"));

    expect(res.status).toBe(200);
    const row = find("an-item");
    expect(row).toBeDefined();
    expect(row!.state).toBe("dropped");
    expect(row!.droppedReason).toBe("superseded by the new flow");
    expect(row!.droppedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses a drop with no reason — a drop with no reason is not a record", async () => {
    const { DELETE } = await routes();
    const res = await DELETE(del("id=an-item"));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("reason") });
    expect(find("an-item")!.state).toBe("next");
  });

  it("refuses to drop something already dropped", async () => {
    seed([item({ state: "dropped", droppedAt: "2026-07-01", droppedReason: "old" })]);
    const { DELETE } = await routes();
    const res = await DELETE(del("id=an-item&reason=again"));

    expect(res.status).toBe(409);
    expect(find("an-item")!.droppedReason).toBe("old");
  });

  it("truly removes an item the user added themselves", async () => {
    seed([item({ origin: "user" })]);
    const { DELETE } = await routes();
    const res = await DELETE(del("id=an-item"));

    expect(res.status).toBe(200);
    expect(find("an-item")).toBeUndefined();
  });

  it("404s an unknown id without writing", async () => {
    const before = disk;
    const { DELETE } = await routes();
    expect((await DELETE(del("id=ghost&reason=x"))).status).toBe(404);
    expect(disk).toBe(before);
  });
});

describe("the concurrency guard", () => {
  it("refuses a write whose expectedHash no longer matches the file", async () => {
    const { GET, DELETE } = await routes();
    const { hash } = (await (await GET()).json()) as { hash: string };

    // Another writer lands between this caller's read and its write.
    seed([item(), item({ id: "added-by-someone-else" })]);

    const res = await DELETE(del(`id=an-item&reason=x&expectedHash=${hash}`));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("changed on disk"),
    });
    // The other writer's row survives — which is the whole point.
    expect(find("added-by-someone-else")).toBeDefined();
    expect(find("an-item")!.state).toBe("next");
  });

  it("allows the write when the hash still matches", async () => {
    const { GET, DELETE } = await routes();
    const { hash } = (await (await GET()).json()) as { hash: string };

    const res = await DELETE(del(`id=an-item&reason=x&expectedHash=${hash}`));
    expect(res.status).toBe(200);
    expect(find("an-item")!.state).toBe("dropped");
  });

  it("stays permissive when no hash is supplied, so existing callers keep working", async () => {
    const { DELETE } = await routes();
    expect((await DELETE(del("id=an-item&reason=x"))).status).toBe(200);
  });

  it("returns the new hash after a write, so a client can chain edits", async () => {
    const { GET, DELETE } = await routes();
    const before = ((await (await GET()).json()) as { hash: string }).hash;
    const res = await DELETE(del("id=an-item&reason=x"));
    const after = (await res.json()) as { hash: string };

    expect(after.hash).toBeTruthy();
    expect(after.hash).not.toBe(before);
    expect(after.hash).toBe(((await (await GET()).json()) as { hash: string }).hash);
  });
});

describe("POST — provenance is required of anything an agent files", () => {
  const base = {
    title: "A new idea",
    lane: "idea",
    level: "soon",
    state: "next",
    importance: "medium",
    area: "Not built yet",
  };

  it("rejects an agent-filed item with no provenance", async () => {
    const { POST } = await routes();
    const res = await POST(post(base));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("provenance") });
    expect(read().items).toHaveLength(1);
  });

  it("accepts it when a source is cited", async () => {
    const { POST } = await routes();
    const res = await POST(post({ ...base, provenance: { doc: "docs/plan.md" } }));

    expect(res.status).toBe(200);
    expect(find("a-new-idea")!.provenance).toEqual({ doc: "docs/plan.md" });
  });

  it("accepts a `note`, which the data uses on 69 rows but the type omits", async () => {
    const { POST } = await routes();
    const res = await POST(post({ ...base, provenance: { note: "raised in review" } }));
    expect(res.status).toBe(200);
  });

  it("treats an all-blank provenance as absent", async () => {
    const { POST } = await routes();
    const res = await POST(post({ ...base, provenance: { doc: "   " } }));
    expect(res.status).toBe(400);
  });

  it("exempts an idea the user adds themselves", async () => {
    const { POST } = await routes();
    const res = await POST(post({ ...base, origin: "user" }));

    expect(res.status).toBe(200);
    expect(find("a-new-idea")!.origin).toBe("user");
  });

  it("ranks sparsely so an insert never renumbers the list", async () => {
    const { POST } = await routes();
    await POST(post({ ...base, origin: "user" }));
    expect(find("a-new-idea")!.rank).toBe(20);
  });

  it("never stamps verifiedAt on a new row", async () => {
    const { POST } = await routes();
    await POST(post({ ...base, origin: "user" }));
    expect(find("a-new-idea")).not.toHaveProperty("verifiedAt");
  });
});

describe("production", () => {
  it("is not mounted", async () => {
    const { DELETE } = await routes();
    vi.stubEnv("NODE_ENV", "production");
    expect((await DELETE(del("id=an-item&reason=x"))).status).toBe(404);
  });
});
