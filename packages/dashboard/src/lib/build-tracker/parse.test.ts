import { describe, expect, it } from "vitest";
import { parseTracker, serializeTracker } from "./parse";
import type { TrackedItem, TrackerDoc } from "./schema";

/**
 * The tracker document is hand-edited by agents and machine-edited by the UI,
 * so the parser is the only thing standing between a typo and a corrupted
 * source of truth. These tests pin the rules that matter: identity is unique,
 * references resolve, and nothing claims a provenance it does not have.
 */

function item(overrides: Partial<TrackedItem> = {}): TrackedItem {
  return {
    id: "webhook-endpoints-ui",
    title: "Webhook endpoints UI",
    lane: "inventory",
    area: "Built, but unreachable",
    level: "soon",
    state: "next",
    importance: "high",
    rank: 10,
    origin: "audit",
    addedAt: "2026-07-22",
    addedBy: "seed",
    provenance: { doc: "docs/status/2026-07-22-build-status-map.md#7" },
    ...overrides,
  };
}

function doc(overrides: Partial<TrackerDoc> = {}): TrackerDoc {
  return {
    meta: {
      seededFrom: ["docs/status/2026-07-22-build-status-map.md"],
      seededAt: "2026-07-22",
      lastEditedAt: null,
      lastEditedBy: null,
    },
    mission: {
      northStar: "Finish the loop Areté already has.",
      statement: "An AI code-review service that proposes human-approved fixes.",
      source: "docs/roadmap/2026-07-15-superlog-phased-roadmap.md:26",
    },
    principles: [
      {
        id: "no-fabrication",
        title: "Never fabricate",
        body: "Empty states must say what is actually true.",
        source: "docs/handoff/2026-07-22-orchestration-briefs.md:43",
      },
    ],
    programmes: [
      {
        id: "observability",
        label: "Observability 0–4",
        standing: "current",
        caveat: "This is what backlog.md is organised around.",
        source: "docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md",
        phases: [
          { key: "0", label: "Trustworthy gates", state: "done" },
          { key: "2b", label: "Deferred from Phase 2", state: "in-progress" },
        ],
      },
    ],
    items: [item()],
    ...overrides,
  };
}

function expectErrors(value: unknown): string[] {
  const result = parseTracker(value);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe("parseTracker", () => {
  it("accepts a well-formed document", () => {
    const result = parseTracker(JSON.parse(serializeTracker(doc())));
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate item ids, because id is identity", () => {
    const errors = expectErrors(doc({ items: [item(), item({ title: "A different title" })] }));
    expect(errors.join("\n")).toContain('duplicate item id "webhook-endpoints-ui"');
  });

  it("names the offending item by id, not by array index", () => {
    const errors = expectErrors(doc({ items: [item({ level: "nope" as never })] }));
    expect(errors.join("\n")).toContain("items[webhook-endpoints-ui].level");
  });

  it.each([
    ["level", { level: "almost" }],
    ["area", { area: "Somewhere else" }],
    ["state", { state: "wip" }],
    ["importance", { importance: "urgent" }],
    ["lane", { lane: "backlog" }],
    ["origin", { origin: "vibes" }],
  ])("rejects an unknown %s", (_field, override) => {
    const errors = expectErrors(doc({ items: [item(override as Partial<TrackedItem>)] }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects a non-integer rank", () => {
    const errors = expectErrors(doc({ items: [item({ rank: 1.5 })] }));
    expect(errors.join("\n")).toContain("rank must be an integer");
  });

  /**
   * The anti-fabrication rule, enforced. An agent must not be able to add a row
   * to this page without saying where the idea came from.
   */
  it("requires provenance when the item was not added by a human", () => {
    const { provenance: _dropped, ...withoutProvenance } = item();
    const errors = expectErrors(doc({ items: [withoutProvenance as TrackedItem] }));
    expect(errors.join("\n")).toContain('provenance is required because origin is "audit"');
  });

  it("exempts user-added items from the provenance requirement", () => {
    const { provenance: _dropped, ...withoutProvenance } = item();
    const result = parseTracker(
      doc({ items: [{ ...withoutProvenance, origin: "user", addedBy: "user" } as TrackedItem] })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a provenance object that cites nothing", () => {
    const errors = expectErrors(doc({ items: [item({ provenance: {} })] }));
    expect(errors.join("\n")).toContain("must name at least one of doc, commit, session, note");
  });

  it("requires a source on every principle", () => {
    const errors = expectErrors(
      doc({ principles: [{ id: "invented", title: "Move fast", body: "Ship it.", source: "" }] })
    );
    expect(errors.join("\n")).toContain("principles[0].source");
  });

  it("rejects a blockedBy pointing at an item that does not exist", () => {
    const errors = expectErrors(doc({ items: [item({ blockedBy: ["ghost-item"] })] }));
    expect(errors.join("\n")).toContain('references unknown item "ghost-item"');
  });

  it("allows an ext: blocker, which is free text by design", () => {
    const result = parseTracker(
      doc({ items: [item({ blockedBy: ["ext:needs a funded Anthropic key"] })] })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a programme reference that does not resolve", () => {
    const errors = expectErrors(
      doc({ items: [item({ programmes: [{ programme: "nope", phase: "0" }] })] })
    );
    expect(errors.join("\n")).toContain('unknown programme "nope"');
  });

  it("rejects a phase that does not exist inside a real programme", () => {
    const errors = expectErrors(
      doc({ items: [item({ programmes: [{ programme: "observability", phase: "99" }] })] })
    );
    expect(errors.join("\n")).toContain('unknown phase "99"');
  });

  it("reports every problem at once rather than only the first", () => {
    const errors = expectErrors(
      doc({ items: [item({ level: "nope" as never, rank: 1.5, state: "wip" as never })] })
    );
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a non-object document", () => {
    expect(expectErrors("nope")).toEqual(["the tracker document must be a JSON object"]);
  });
});

describe("serializeTracker", () => {
  it("round-trips a document unchanged", () => {
    const original = doc();
    const result = parseTracker(JSON.parse(serializeTracker(original)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(original);
  });

  /**
   * The property that keeps an edit to a one-line git diff. If key order or
   * spacing drifted between writes, every save would reshuffle the file and the
   * history would stop being reviewable — which is much of why this is a file.
   */
  it("is byte-stable across repeated writes", () => {
    const original = doc();
    expect(serializeTracker(original)).toBe(serializeTracker(original));
  });

  it("survives a parse/serialize/parse cycle byte-identically", () => {
    const first = serializeTracker(doc());
    const reparsed = parseTracker(JSON.parse(first));
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(serializeTracker(reparsed.doc)).toBe(first);
  });

  it("ends with a trailing newline", () => {
    expect(serializeTracker(doc()).endsWith("}\n")).toBe(true);
  });

  it("omits absent optional fields rather than writing nulls", () => {
    const json = serializeTracker(doc());
    expect(json).not.toContain('"href"');
    expect(json).not.toContain('"droppedAt"');
  });
});
