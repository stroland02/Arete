import { describe, it, expect } from "vitest";
import { deriveTriage } from "./triage";

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
