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

  it("exposes a link through to the fix run when the incident opened a WorkItem with a live container", () => {
    const html = renderToStaticMarkup(
      <IncidentList incidents={[incident({ workItemId: "wi-1", fixContainerId: "container-9" })]} />
    );
    expect(html).toContain("/services?container=container-9");
    expect(html).toMatch(/fix run/i);
  });

  it("does not render a fix-run link when no WorkItem is linked", () => {
    const html = renderToStaticMarkup(
      <IncidentList incidents={[incident({ workItemId: null, fixContainerId: null })]} />
    );
    expect(html).not.toContain("/services?container=");
  });

  it("empty → honest empty state, no fabricated rows", () => {
    const html = renderToStaticMarkup(<IncidentList incidents={[]} />);
    expect(html).toMatch(/no incidents/i);
    expect(html).not.toContain("HighErrorRate");
  });
});
