import { describe, it, expect } from "vitest";
import { getAccountState, disconnectedState } from "./account-state";

// The CI guard for the Account-State Contract. These assertions ARE the
// three-state rule: a connected repo with no reviews must resolve to
// "connected_idle", never "disconnected" — the desync bug that showed a
// "connect a repo" prompt when a repo was already connected.

function fakeDb(opts: {
  repos: number;
  models: number;
  reviews: number;
  pendingModels?: number;
  scans?: number;
  telemetry?: number;
}) {
  const repoRows = Array.from({ length: opts.repos }, (_, i) => ({ id: `r${i}` }));
  return {
    repository: { findMany: async () => repoRows },
    modelConnection: {
      // Two where shapes reach this: the pending-only probe ({ userId,
      // installationId: null }, no-installations branch) and the combined
      // installation-or-pending OR (installations branch).
      count: async (args: { where: { userId?: string; installationId?: null } }) =>
        args.where.userId && args.where.installationId === null
          ? (opts.pendingModels ?? 0)
          : opts.models,
    },
    review: { count: async () => opts.reviews },
    scanRun: { count: async () => opts.scans ?? 0 },
    telemetryConnection: { count: async () => opts.telemetry ?? 0 },
  } as never;
}

describe("getAccountState — the three-state rule", () => {
  it("no installations → disconnected", async () => {
    const s = await getAccountState(fakeDb({ repos: 0, models: 0, reviews: 0 }), []);
    expect(s.stage).toBe("disconnected");
    expect(s.repoConnected).toBe(false);
  });

  it("repo connected, no reviews → connected_idle (NOT disconnected)", async () => {
    const s = await getAccountState(fakeDb({ repos: 1, models: 0, reviews: 0 }), ["inst-1"]);
    expect(s.stage).toBe("connected_idle");
    expect(s.repoConnected).toBe(true);
    expect(s.hasReviews).toBe(false);
    // The regression this guards: connected must never read as disconnected.
    expect(s.stage).not.toBe("disconnected");
  });

  it("repo + model connected, no reviews → connected_idle, modelConnected true", async () => {
    const s = await getAccountState(fakeDb({ repos: 1, models: 1, reviews: 0 }), ["inst-1"]);
    expect(s.stage).toBe("connected_idle");
    expect(s.modelConnected).toBe(true);
  });

  it("reviews exist → active", async () => {
    const s = await getAccountState(fakeDb({ repos: 1, models: 1, reviews: 3 }), ["inst-1"]);
    expect(s.stage).toBe("active");
    expect(s.hasReviews).toBe(true);
    expect(s.reviewCount).toBe(3);
  });

  it("no installations + pending user-scoped model → stage disconnected but modelConnected true", async () => {
    const s = await getAccountState(
      fakeDb({ repos: 0, models: 0, reviews: 0, pendingModels: 1 }),
      [],
      "user-1",
    );
    // Model is setup step 1: the pending connection surfaces honestly while the
    // repo (the stage driver) is still missing.
    expect(s.stage).toBe("disconnected");
    expect(s.modelConnected).toBe(true);
    expect(s.repoConnected).toBe(false);
  });

  it("no installations and no userId → plain disconnected (no pending probe)", async () => {
    const s = await getAccountState(fakeDb({ repos: 0, models: 0, reviews: 0, pendingModels: 5 }), []);
    expect(s.modelConnected).toBe(false);
  });

  it("scan + telemetry counts surface as scanCompleted / telemetryConnected", async () => {
    const s = await getAccountState(
      fakeDb({ repos: 1, models: 1, reviews: 0, scans: 2, telemetry: 1 }),
      ["inst-1"],
    );
    expect(s.scanCompleted).toBe(true);
    expect(s.telemetryConnected).toBe(true);
  });

  it("disconnectedState() is the canonical empty", () => {
    expect(disconnectedState().stage).toBe("disconnected");
  });
});
