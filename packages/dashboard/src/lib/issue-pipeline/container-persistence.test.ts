import { describe, it, expect } from "vitest";
import { PrismaContainerStore, type PersistContainerInput } from "./container-persistence";
import type { IssueContainer } from "./types";

// In-memory fake of the slice of Prisma the store uses, same pattern as
// users.test.ts / queries.test.ts. updateMany is scoped by (id, installationId)
// so tenancy is exercised: a wrong installationId matches zero rows.
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  return {
    _rows: rows,
    issueContainer: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        rows.push({ ...data });
        return data;
      },
      findFirst: async ({ where }: { where: { id: string; installationId: string } }) =>
        rows.find((r) => r.id === where.id && r.installationId === where.installationId) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; installationId: string };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const r of rows) {
          if (r.id === where.id && r.installationId === where.installationId) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      },
    },
  };
}

function container(over: Partial<IssueContainer> = {}): IssueContainer {
  return {
    id: "c1",
    installationId: "inst-acme",
    serviceId: "payments-api",
    fingerprint: "payments-api::typeerror::charge()",
    source: "Sentry",
    severity: "critical",
    state: "detecting",
    firstSeen: "2026-07-16T00:00:00Z",
    lastSeen: "2026-07-16T00:00:00Z",
    occurrences: 1,
    evidence: [],
    findings: [],
    transcript: [],
    pr: null,
    gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    ...over,
  };
}

const input = (over: Partial<PersistContainerInput> = {}): PersistContainerInput => ({
  container: container(),
  target: { owner: "acme", repo: "payments" },
  patch: [{ path: "src/billing/handlers.ts", content: "// fixed\n" }],
  ...over,
});

describe("PrismaContainerStore.create", () => {
  it("writes a row in Eng1's read contract shape, scoped by installationId", async () => {
    const db = fakeDb();
    await new PrismaContainerStore(db).create(input());
    expect(db._rows).toHaveLength(1);
    const row = db._rows[0];
    expect(row.id).toBe("c1");
    expect(row.installationId).toBe("inst-acme");
    expect(row.state).toBe("detecting");
    // The JSON columns loadApprovedContainer / stagePullRequest read:
    expect(row.gates).toMatchObject({ solutionApprovedAt: null });
    expect(row.target).toEqual({ owner: "acme", repo: "payments" });
    expect(row.pr).toMatchObject({ base: expect.any(String), title: expect.any(String), body: expect.any(String) });
    expect(row.patch).toEqual([{ path: "src/billing/handlers.ts", content: "// fixed\n" }]);
  });

  it("derives pr {base,title,body} from a composed container.pr when present", async () => {
    const db = fakeDb();
    const pr = { number: null, base: "main", branch: "arete/fix-c1", title: "Kuma fix", body: "why", comments: [], state: "ready" as const, hostUrl: null };
    await new PrismaContainerStore(db).create(input({ container: container({ pr }) }));
    expect(db._rows[0].pr).toEqual({ base: "main", title: "Kuma fix", body: "why" });
  });
});

describe("PrismaContainerStore.load", () => {
  it("returns the stored container for the right tenant, null for a wrong one (tenancy)", async () => {
    const db = fakeDb();
    const store = new PrismaContainerStore(db);
    await store.create(input());
    const hit = await store.load("c1", "inst-acme");
    expect(hit).not.toBeNull();
    expect(hit?.state).toBe("detecting");
    expect(hit?.gates.solutionApprovedAt).toBeNull();
    expect(await store.load("c1", "inst-evil")).toBeNull(); // cross-tenant read blocked
    expect(await store.load("missing", "inst-acme")).toBeNull();
  });
});

describe("PrismaContainerStore.save", () => {
  it("advances state + gates only for the matching tenant row", async () => {
    const db = fakeDb();
    const store = new PrismaContainerStore(db);
    await store.create(input());
    const ok = await store.save("c1", "inst-acme", {
      state: "ready",
      gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
    });
    expect(ok).toBe(true);
    expect((await store.load("c1", "inst-acme"))?.state).toBe("ready");
  });

  it("writes nothing and reports false when the tenant does not match (no cross-tenant write)", async () => {
    const db = fakeDb();
    const store = new PrismaContainerStore(db);
    await store.create(input());
    const ok = await store.save("c1", "inst-evil", {
      state: "solution_approved",
      gates: { solutionApprovedAt: "2026-07-16T01:00:00Z", solutionApprovedBy: "evil", postedAt: null, postedBy: null },
    });
    expect(ok).toBe(false);
    expect((await store.load("c1", "inst-acme"))?.state).toBe("detecting"); // untouched
  });

  it("persists the composed pr {base,title,body} when the driver reaches ready", async () => {
    const db = fakeDb();
    const store = new PrismaContainerStore(db);
    await store.create(input()); // created at detecting, empty pr
    await store.save("c1", "inst-acme", {
      state: "ready",
      gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
      pr: { base: "main", title: "Kuma fix", body: "why" },
    });
    expect((await store.load("c1", "inst-acme"))?.pr).toEqual({ base: "main", title: "Kuma fix", body: "why" });
  });

  it("persists the solution-approval gate (what loadApprovedContainer reads for the send)", async () => {
    const db = fakeDb();
    const store = new PrismaContainerStore(db);
    await store.create(input({ container: container({ state: "ready" }) }));
    await store.save("c1", "inst-acme", {
      state: "solution_approved",
      gates: { solutionApprovedAt: "2026-07-16T01:00:00Z", solutionApprovedBy: "ada@acme.com", postedAt: null, postedBy: null },
    });
    const loaded = await store.load("c1", "inst-acme");
    expect(loaded?.state).toBe("solution_approved");
    expect(loaded?.gates.solutionApprovedAt).toBe("2026-07-16T01:00:00Z");
  });
});
