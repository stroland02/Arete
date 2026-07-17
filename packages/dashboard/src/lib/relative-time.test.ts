import { describe, it, expect } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = new Date("2026-07-17T12:00:00Z");

describe("relativeTime", () => {
  it("under a minute → 'just now'", () => {
    expect(relativeTime(new Date("2026-07-17T11:59:30Z"), NOW)).toBe("just now");
  });
  it("minutes", () => {
    expect(relativeTime(new Date("2026-07-17T11:42:00Z"), NOW)).toBe("18m ago");
  });
  it("hours", () => {
    expect(relativeTime(new Date("2026-07-17T09:00:00Z"), NOW)).toBe("3h ago");
  });
  it("days", () => {
    expect(relativeTime(new Date("2026-07-14T12:00:00Z"), NOW)).toBe("3d ago");
  });
  it("7+ days → locale date", () => {
    const d = new Date("2026-07-01T12:00:00Z");
    expect(relativeTime(d, NOW)).toBe(d.toLocaleDateString());
  });
});
