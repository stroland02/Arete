import { describe, it, expect } from "vitest";
import { getAccountState, disconnectedState } from "./account-state";

// The CI guard for the Account-State Contract. These assertions ARE the
// three-state rule: a connected repo with no reviews must resolve to
// "connected_idle", never "disconnected" — the desync bug that showed a
// "connect a repo" prompt when a repo was already connected.

function fakeDb(opts: { repos: number; models: number; reviews: number }) {
  const repoRows = Array.from({ length: opts.repos }, (_, i) => ({ id: `r${i}` }));
  return {
    repository: { findMany: async () => repoRows },
    modelConnection: { count: async () => opts.models },
    review: { count: async () => opts.reviews },
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

  it("disconnectedState() is the canonical empty", () => {
    expect(disconnectedState().stage).toBe("disconnected");
  });
});
