import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The workspace (and NewInvestigationDialog) import the incidents server
// actions, which pull in auth/db/next-cache. Nothing here exercises a mutation,
// so stub the module rather than boot the world.
vi.mock("@/app/(dashboard)/incidents/actions", () => ({
  createInvestigationAction: async () => ({}),
  setIncidentNoiseAction: async () => {},
  setErrorStatusAction: async () => {},
  attachErrorAction: async () => {},
  resolveIncidentWithErrorsAction: async () => {},
}));

const { IncidentsWorkspace, matchesErrorFilter } = await import("./incidents-workspace");

type Workspace = typeof IncidentsWorkspace;
type ErrorGroupView = NonNullable<Parameters<Workspace>[0]["errors"]>[number];
type IncidentView = Parameters<Workspace>[0]["incidents"][number];

function incident(overrides: Partial<IncidentView> = {}): IncidentView {
  return {
    id: "inc-1",
    fingerprint: "fp-1",
    alertName: "HighErrorRate",
    severity: "critical",
    status: "firing",
    summary: "Error rate exceeded 5% for 10 minutes",
    startsAt: new Date().toISOString(),
    resolvedAt: null,
    noisedAt: null,
    source: "alert",
    workItemId: null,
    fixContainerId: null,
    ...overrides,
  } as IncidentView;
}

function group(overrides: Partial<ErrorGroupView> = {}): ErrorGroupView {
  return {
    fingerprint: "fp-1",
    kind: "exception",
    service: "api",
    title: "TypeError: boom",
    message: "at handleReview (src/lib/review.ts:42)",
    eventCount: 12,
    firstSeen: new Date("2026-07-20T10:00:00Z").toISOString(),
    lastSeen: new Date("2026-07-21T10:00:00Z").toISOString(),
    dailyCounts: [1, 3, 8],
    sampleTraceId: null,
    status: "open",
    incidentId: null,
    incidentAlertName: null,
    ...overrides,
  } as ErrorGroupView;
}

describe("IncidentsWorkspace — the two views", () => {
  it("offers a top-level Incidents | Errors switch, opening on Incidents", () => {
    const html = renderToStaticMarkup(
      <IncidentsWorkspace incidents={[incident()]} installationId="inst-1" errors={[]} />
    );
    expect(html).toContain('aria-label="Incidents view"');
    expect(html).toContain("Incidents");
    expect(html).toContain("Errors");
    // Incidents is the selected view, so its status tabs are what's showing.
    expect(html).toContain('aria-label="Incident status"');
    expect(html).not.toContain('aria-label="Error status"');
  });
});

describe("IncidentsWorkspace — Incidents view (unchanged behavior)", () => {
  it("keeps the Open / Resolved / Noise / All tabs, the count and New investigation", () => {
    const html = renderToStaticMarkup(
      <IncidentsWorkspace
        incidents={[incident({ id: "inc-1" }), incident({ id: "inc-2", alertName: "DiskFull" })]}
        installationId="inst-1"
        errors={[group()]}
      />
    );
    expect(html).toContain("Open");
    expect(html).toContain("Resolved");
    expect(html).toContain("Noise");
    expect(html).toContain("All");
    expect(html).toContain("2 incidents");
    expect(html).toContain("New investigation");
    expect(html).toContain("HighErrorRate");
    expect(html).toContain("DiskFull");
    // Error rows never leak into the incidents view.
    expect(html).not.toContain("TypeError: boom");
  });

  it("defaults to open incidents — resolved and noise rows stay out", () => {
    const html = renderToStaticMarkup(
      <IncidentsWorkspace
        incidents={[
          incident({ id: "inc-1", status: "firing", alertName: "StillFiring" }),
          incident({ id: "inc-2", status: "resolved", alertName: "AlreadyCleared" }),
          incident({ id: "inc-3", noisedAt: new Date().toISOString(), alertName: "JustNoise" }),
        ]}
        installationId="inst-1"
      />
    );
    expect(html).toContain("StillFiring");
    expect(html).not.toContain("AlreadyCleared");
    expect(html).not.toContain("JustNoise");
    expect(html).toContain("1 incident");
  });

  it("empty open tab → honest empty state", () => {
    const html = renderToStaticMarkup(
      <IncidentsWorkspace incidents={[]} installationId="inst-1" errors={null} />
    );
    expect(html).toContain("No open incidents");
  });
});

describe("IncidentsWorkspace — Errors view", () => {
  it("lists error rows with their own status tabs and an 'N errors' count", () => {
    const html = renderToStaticMarkup(
      <IncidentsWorkspace
        incidents={[]}
        installationId="inst-1"
        initialView="errors"
        errors={[
          group({ fingerprint: "fp-1", title: "TypeError: boom", status: "open" }),
          group({ fingerprint: "fp-2", title: "ECONNREFUSED", status: "open", service: "worker" }),
        ]}
      />
    );
    expect(html).toContain('aria-label="Error status"');
    expect(html).toContain("Observing");
    expect(html).toContain("Silenced");
    expect(html).toContain("2 errors");
    expect(html).toContain("TypeError: boom");
    expect(html).toContain("ECONNREFUSED");
  });

  it("shows which incident each error is connected to", () => {
    const html = renderToStaticMarkup(
      <IncidentsWorkspace
        incidents={[]}
        installationId="inst-1"
        initialView="errors"
        errors={[group({ incidentId: "inc-7", incidentAlertName: "HighErrorRate" })]}
      />
    );
    expect(html).toContain('href="/incidents/inc-7"');
    expect(html).toContain("HighErrorRate");
  });

  it("partitions rows by status — the Open tab hides observing/resolved/silenced", () => {
    const html = renderToStaticMarkup(
      <IncidentsWorkspace
        incidents={[]}
        installationId="inst-1"
        initialView="errors"
        errors={[
          group({ fingerprint: "fp-1", title: "OpenOne", status: "open" }),
          group({ fingerprint: "fp-2", title: "ObservingOne", status: "observing" }),
          group({ fingerprint: "fp-3", title: "ResolvedOne", status: "resolved" }),
          group({ fingerprint: "fp-4", title: "SilencedOne", status: "silenced" }),
        ]}
      />
    );
    expect(html).toContain("OpenOne");
    expect(html).not.toContain("ObservingOne");
    expect(html).not.toContain("ResolvedOne");
    expect(html).not.toContain("SilencedOne");
    expect(html).toContain("1 error");
  });

  it("matchesErrorFilter partitions every status, and 'all' keeps everything", () => {
    const rows = [
      group({ fingerprint: "a", status: "open" }),
      group({ fingerprint: "b", status: "observing" }),
      group({ fingerprint: "c", status: "resolved" }),
      group({ fingerprint: "d", status: "silenced" }),
    ];
    expect(rows.filter((r) => matchesErrorFilter(r, "open")).map((r) => r.fingerprint)).toEqual(["a"]);
    expect(rows.filter((r) => matchesErrorFilter(r, "observing")).map((r) => r.fingerprint)).toEqual(["b"]);
    expect(rows.filter((r) => matchesErrorFilter(r, "resolved")).map((r) => r.fingerprint)).toEqual(["c"]);
    expect(rows.filter((r) => matchesErrorFilter(r, "silenced")).map((r) => r.fingerprint)).toEqual(["d"]);
    expect(rows.filter((r) => matchesErrorFilter(r, "all"))).toHaveLength(4);
  });

  it("empty Open tab → honest per-filter empty state, not an all-clear", () => {
    const html = renderToStaticMarkup(
      <IncidentsWorkspace
        incidents={[]}
        installationId="inst-1"
        initialView="errors"
        errors={[group({ status: "silenced" })]}
      />
    );
    expect(html).toContain("No open errors");
    expect(html).toContain("0 errors");
  });

  it("errors === null → an explicit UNAVAILABLE panel, never an all-clear", () => {
    const html = renderToStaticMarkup(
      <IncidentsWorkspace incidents={[]} installationId="inst-1" initialView="errors" errors={null} />
    );
    expect(html).toMatch(/aren&#x27;t available|aren't available/);
    expect(html).toMatch(/not an all-clear/i);
    // Crucially: no zero-count and no "no errors" claim we cannot stand behind.
    expect(html).not.toContain("0 errors");
    expect(html).not.toMatch(/No open errors/);
    expect(html).not.toMatch(/No errors recorded/);
    // And no error status filter strip over data we don't have.
    expect(html).not.toContain('aria-label="Error status"');
  });
});
