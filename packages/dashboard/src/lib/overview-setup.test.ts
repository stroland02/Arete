import { describe, it, expect } from "vitest";
import { deriveOverviewSetup } from "./overview-setup";

// State-matrix test for the OVERVIEW surface's adoption of the Account-State
// Contract: the onboarding card must render the correct next-action for each
// of the three stages, derived from the resolver — never collapsing
// "connected but idle" into "not connected".

describe("deriveOverviewSetup — the three-state matrix", () => {
  it("disconnected → next step is 'Connect a repository', not complete", () => {
    const s = deriveOverviewSetup({ repoConnected: false, modelConnected: false, hasReviews: false });
    expect(s.setupComplete).toBe(false);
    expect(s.nextStep?.label).toBe("Connect a repository");
    expect(s.doneCount).toBe(1); // only "Create your Kuma account"
  });

  it("repo connected, no model → next step is 'Connect an AI model', NEVER 'Connect a repository'", () => {
    const s = deriveOverviewSetup({ repoConnected: true, modelConnected: false, hasReviews: false });
    expect(s.setupComplete).toBe(false);
    expect(s.nextStep?.label).toBe("Connect an AI model");
    // The regression this guards: a connected repo must never prompt to connect one.
    expect(s.nextStep?.label).not.toBe("Connect a repository");
    expect(s.steps.find((x) => x.label === "Connect a repository")?.done).toBe(true);
    expect(s.doneCount).toBe(2);
  });

  it("repo + model connected, no reviews → next step is 'Open a pull request'", () => {
    const s = deriveOverviewSetup({ repoConnected: true, modelConnected: true, hasReviews: false });
    expect(s.setupComplete).toBe(false);
    expect(s.nextStep?.label).toBe("Open a pull request");
    expect(s.steps.find((x) => x.label === "Connect an AI model")?.done).toBe(true);
    expect(s.doneCount).toBe(3);
  });

  it("active → setup complete, no next step", () => {
    const s = deriveOverviewSetup({ repoConnected: true, modelConnected: true, hasReviews: true });
    expect(s.setupComplete).toBe(true);
    expect(s.nextStep).toBeUndefined();
    expect(s.doneCount).toBe(5);
  });
});
