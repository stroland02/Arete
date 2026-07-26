import { describe, it, expect } from "vitest";
import { deriveTriage, workItemTriageStatus } from "./triage";

describe("deriveTriage", () => {
  it("counts each bucket, ignoring clear", () => {
    expect(
      deriveTriage([
        { status: "awaiting" }, { status: "awaiting" },
        { status: "in_flight" }, { status: "blocked" }, { status: "clear" },
      ])
    ).toEqual({ awaiting: 2, inFlight: 1, blocked: 1 });
  });
  it("empty → all zero (honest)", () => {
    expect(deriveTriage([])).toEqual({ awaiting: 0, inFlight: 0, blocked: 0 });
  });
});

// The counter must agree with the gates the panel offers for the same item —
// "Awaiting approval: 0" beside a live Approve button is a contradiction on a
// single screen, so both read the container's state through the same rule.
describe("workItemTriageStatus", () => {
  it("counts a container that is ready as awaiting the human", () => {
    expect(workItemTriageStatus({ state: "fixing", containerId: "cont-7", containerState: "ready" }))
      .toBe("awaiting");
  });

  it("counts an approved-and-staged item as awaiting the send decision", () => {
    expect(workItemTriageStatus({ state: "staged", containerId: "cont-7", containerState: "solution_approved" }))
      .toBe("awaiting");
  });

  it("counts a still-composing container as in flight, not awaiting", () => {
    for (const containerState of ["detecting", "fanning_out", "verifying", "composing"]) {
      expect(workItemTriageStatus({ state: "fixing", containerId: "cont-7", containerState }))
        .toBe("in_flight");
    }
  });

  it("counts an unknown container state as in flight — never as a decision that cannot be made", () => {
    expect(workItemTriageStatus({ state: "fixing", containerId: "cont-7", containerState: null }))
      .toBe("in_flight");
  });

  it("counts a failed fix run as blocked", () => {
    expect(workItemTriageStatus({ state: "fixing", containerId: "cont-7", containerState: "fix_failed" }))
      .toBe("blocked");
  });

  it("counts untriaged and finished items as clear", () => {
    expect(workItemTriageStatus({ state: "open", containerId: null })).toBe("clear");
    expect(workItemTriageStatus({ state: "posted", containerId: "cont-7" })).toBe("clear");
    // staged with no container: nothing can act on it, so it is not "awaiting"
    expect(workItemTriageStatus({ state: "staged", containerId: null })).toBe("clear");
  });
});
