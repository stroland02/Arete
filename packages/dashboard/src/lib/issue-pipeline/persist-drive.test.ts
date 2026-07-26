import { describe, it, expect } from "vitest";
import { persistDrive } from "./persist-drive";
import { PrismaContainerStore } from "./container-persistence";
import type { DispatchPlan, QaResult } from "@arete/orchestration";
import type { Diff, Finding, IssueContainer } from "./types";

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
      updateMany: async ({ where, data }: { where: { id: string; installationId: string }; data: Record<string, unknown> }) => {
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

const T0 = "2026-07-16T00:00:00Z";
const FILE = "src/billing/handlers.ts";

const BASE: IssueContainer = {
  id: "c1",
  installationId: "inst-acme",
  serviceId: "payments-api",
  fingerprint: "fp",
  source: "Sentry",
  severity: "critical",
  state: "detecting",
  firstSeen: T0,
  lastSeen: T0,
  occurrences: 1,
  evidence: [],
  findings: [],
  transcript: [],
  pr: null,
  gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
  createdAt: T0,
  updatedAt: T0,
};

const PLAN: DispatchPlan = {
  problemId: "c1",
  analysis: "null deref",
  assignments: [
    { specialty: "fix-author", taskId: "fix", title: "fix", owner: "kuma-fix", dependsOn: [], lane: { packages: [], globs: [] } },
  ],
};

const finding = (id: string, line: number): Finding => ({
  id, agentId: "security", category: "security", file: FILE, line, rationale: "why", diff: [], verdict: "candidate",
});

const REPORTS = [{ agentId: "security", label: "Security", candidates: [finding("f1", 42)] }];
const DIFF: Diff = [{ file: FILE, line: 42 }];
const QA: QaResult[] = [{ pass: true }];

const driveInput = () => ({
  container: BASE,
  plan: PLAN,
  reports: REPORTS,
  diff: DIFF,
  qaResults: QA,
  compose: { base: "main", branch: "arete/fix-c1" },
  now: () => T0,
});

describe("persistDrive", () => {
  it("creates the row at Fix-run start, then persists the resolved state + composed pr", async () => {
    const db = fakeDb();
    const store = new PrismaContainerStore(db);
    const result = await persistDrive(store, driveInput(), {
      target: { owner: "acme", repo: "payments" },
      patch: [{ path: FILE, content: "// fixed\n" }],
    });

    expect(result.outcome).toBe("ready");
    // A row was created (scoped to the tenant) and advanced to the resolved state.
    const loaded = await store.load("c1", "inst-acme");
    expect(loaded?.state).toBe("ready");
    expect(loaded?.target).toEqual({ owner: "acme", repo: "payments" });
    expect(loaded?.patch).toEqual([{ path: FILE, content: "// fixed\n" }]);
    // The composed PR metadata the webhook stages from is persisted.
    expect(loaded?.pr.title).toContain("Kuma review");
    // HITL moat: the driver never crosses `ready` — the gate stays unset.
    expect(loaded?.gates.solutionApprovedAt).toBeNull();
  });

  it("does not double-create — a Fix run is one row (create called once)", async () => {
    const db = fakeDb();
    const store = new PrismaContainerStore(db);
    await persistDrive(store, driveInput(), { target: { owner: "acme", repo: "payments" }, patch: [] });
    expect(db._rows).toHaveLength(1);
  });
});
