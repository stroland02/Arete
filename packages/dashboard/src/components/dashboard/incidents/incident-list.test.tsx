import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IncidentList } from "./incident-list";
import type { IncidentView } from "@/lib/incidents";

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
  };
}

describe("IncidentList", () => {
  it("renders firing and resolved incidents with distinct status treatment", () => {
    const html = renderToStaticMarkup(
      <IncidentList
        incidents={[
          incident({ id: "inc-1", status: "firing", alertName: "HighErrorRate" }),
          incident({
            id: "inc-2",
            status: "resolved",
            alertName: "DiskFull",
            resolvedAt: new Date().toISOString(),
          }),
        ]}
      />
    );
    expect(html).toContain("HighErrorRate");
    expect(html).toContain("DiskFull");
    expect(html).toMatch(/firing/i);
    expect(html).toMatch(/resolved/i);
    // Distinct visual treatment: the firing row's status dot must not use the
    // same accent class as the resolved row's.
    expect(html).toContain("bg-accent-danger");
    expect(html).toContain("bg-accent-success");
  });

  it("shows severity and summary for each incident", () => {
    const html = renderToStaticMarkup(
      <IncidentList incidents={[incident({ severity: "warning", summary: "Queue depth above threshold" })]} />
    );
    expect(html).toMatch(/warning/i);
    expect(html).toContain("Queue depth above threshold");
  });

  it("links each row through to its incident detail page", () => {
    const html = renderToStaticMarkup(
      <IncidentList incidents={[incident({ id: "inc-1" })]} />
    );
    expect(html).toContain('href="/incidents/inc-1"');
  });

  it("hints at the fix run when the incident opened a WorkItem with a live container (the actual link lives on the detail page)", () => {
    const html = renderToStaticMarkup(
      <IncidentList incidents={[incident({ workItemId: "wi-1", fixContainerId: "container-9" })]} />
    );
    expect(html).toMatch(/fix run/i);
    // No second, nested link to /services — the row's own link (to the
    // incident detail page) is the only anchor; the detail page carries the
    // first-class "View fix run" action.
    expect(html).not.toContain("/services?container=");
  });

  it("shows a plain 'Fix opened' hint when no live container exists yet", () => {
    const html = renderToStaticMarkup(
      <IncidentList incidents={[incident({ workItemId: "wi-1", fixContainerId: null })]} />
    );
    expect(html).toMatch(/fix opened/i);
  });

  it("empty → honest empty state, no fabricated rows", () => {
    const html = renderToStaticMarkup(<IncidentList incidents={[]} />);
    expect(html).toMatch(/no incidents/i);
    expect(html).not.toContain("HighErrorRate");
  });
});
