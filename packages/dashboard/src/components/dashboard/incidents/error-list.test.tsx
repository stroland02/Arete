import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorList } from "./error-list";
import type { ErrorGroupView } from "@/lib/errors";

// The Jaeger base URL the trace link is built from. Unset by default so every
// pre-existing assertion below runs in the "no Jaeger configured" world, which
// is also the default for any deployment that hasn't wired one up.
const ORIGINAL_JAEGER = process.env.NEXT_PUBLIC_JAEGER_UI_URL;

function setJaeger(value: string | undefined): void {
  if (value === undefined) delete process.env.NEXT_PUBLIC_JAEGER_UI_URL;
  else process.env.NEXT_PUBLIC_JAEGER_UI_URL = value;
}

beforeEach(() => {
  setJaeger(undefined);
});

afterAll(() => {
  setJaeger(ORIGINAL_JAEGER);
});

function group(overrides: Partial<ErrorGroupView> = {}): ErrorGroupView {
  return {
    fingerprint: "fp-1",
    kind: "exception",
    service: "api",
    title: "TypeError: cannot read property 'id' of undefined",
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
  };
}

describe("ErrorList", () => {
  it("renders each error's title, service and event count", () => {
    const html = renderToStaticMarkup(
      <ErrorList
        errors={[
          group({ fingerprint: "fp-1", title: "TypeError: boom", service: "api", eventCount: 12 }),
          group({
            fingerprint: "fp-2",
            title: "ECONNREFUSED",
            service: "worker",
            eventCount: 1,
            kind: "log",
          }),
        ]}
      />
    );
    expect(html).toContain("TypeError: boom");
    expect(html).toContain("ECONNREFUSED");
    expect(html).toContain("api");
    expect(html).toContain("worker");
    expect(html).toContain("12 events");
    // Singular is not pluralised — small honesty, but the kind we keep.
    expect(html).toContain("1 event");
  });

  it("distinguishes exceptions from log-born errors", () => {
    const html = renderToStaticMarkup(
      <ErrorList
        errors={[
          group({ fingerprint: "fp-1", kind: "exception" }),
          group({ fingerprint: "fp-2", kind: "log" }),
        ]}
      />
    );
    expect(html).toContain("Exception");
    expect(html).toContain("Log");
  });

  it("gives each status its own treatment", () => {
    const html = renderToStaticMarkup(
      <ErrorList
        errors={[
          group({ fingerprint: "fp-1", status: "open" }),
          group({ fingerprint: "fp-2", status: "observing" }),
          group({ fingerprint: "fp-3", status: "resolved" }),
          group({ fingerprint: "fp-4", status: "silenced" }),
        ]}
      />
    );
    expect(html).toContain("bg-accent-danger");
    expect(html).toContain("bg-accent-warning");
    expect(html).toContain("bg-accent-success");
    expect(html).toMatch(/silenced/);
  });

  it("links the connected incident when the error is attached to one", () => {
    const html = renderToStaticMarkup(
      <ErrorList
        errors={[
          group({
            incidentId: "inc-7",
            incidentAlertName: "HighErrorRate",
          }),
        ]}
      />
    );
    expect(html).toContain('href="/incidents/inc-7"');
    expect(html).toContain("HighErrorRate");
  });

  it("shows NO incident chip when the error is not connected to one", () => {
    const html = renderToStaticMarkup(
      <ErrorList errors={[group({ incidentId: null, incidentAlertName: null })]} />
    );
    expect(html).not.toContain("/incidents/");
    // No "unassigned"/"none" fiction either — the chip is simply absent.
    expect(html).not.toMatch(/connected incident/i);
  });

  it("draws a sparkline only when there is a real multi-point series", () => {
    const withSeries = renderToStaticMarkup(
      <ErrorList errors={[group({ dailyCounts: [1, 4, 2, 9] })]} />
    );
    expect(withSeries).toContain("<svg");
    expect(withSeries).toContain("polyline");

    const singlePoint = renderToStaticMarkup(
      <ErrorList errors={[group({ fingerprint: "fp-single", dailyCounts: [5] })]} />
    );
    expect(singlePoint).not.toContain("polyline");

    const noPoints = renderToStaticMarkup(
      <ErrorList errors={[group({ fingerprint: "fp-none", dailyCounts: [] })]} />
    );
    expect(noPoints).not.toContain("polyline");
  });

  it("shows the error message on its own line", () => {
    const html = renderToStaticMarkup(
      <ErrorList errors={[group({ message: "at handleReview (src/lib/review.ts:42)" })]} />
    );
    expect(html).toContain("at handleReview (src/lib/review.ts:42)");
  });

  it("renders no mutation affordance when no status action is supplied", () => {
    const html = renderToStaticMarkup(<ErrorList errors={[group()]} />);
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/Silence/);
  });

  it("offers Resolve / Silence when a status action is supplied", () => {
    const html = renderToStaticMarkup(<ErrorList errors={[group()]} statusAction={() => {}} />);
    expect(html).toContain("<form");
    expect(html).toMatch(/Resolve/);
    expect(html).toMatch(/Silence/);
    expect(html).toContain('value="fp-1"');
  });

  it("links a row's sample trace into Jaeger when one can be opened", () => {
    setJaeger("http://localhost:16686");
    const html = renderToStaticMarkup(
      <ErrorList errors={[group({ sampleTraceId: "4bf92f3577b34da6a3ce929d0e0e4736" })]} />
    );
    expect(html).toContain(
      'href="http://localhost:16686/trace/4bf92f3577b34da6a3ce929d0e0e4736"'
    );
    expect(html).toContain("Trace");
    // Opens the external tool in its own tab, without handing it window.opener.
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it("shows NO trace link at all when no Jaeger UI is configured", () => {
    // THE honesty assertion: with nowhere to send the operator we render
    // nothing — not a disabled link, not a dead anchor, not the word "Trace"
    // dangling as a promise the deployment can't keep.
    const html = renderToStaticMarkup(
      <ErrorList errors={[group({ sampleTraceId: "4bf92f3577b34da6a3ce929d0e0e4736" })]} />
    );
    expect(html).not.toContain("<a");
    expect(html).not.toMatch(/Trace/i);
    expect(html).not.toContain("/trace/");
    expect(html).not.toContain("16686");
  });

  it("shows no trace link when the group has no sample trace id", () => {
    setJaeger("http://localhost:16686");
    const html = renderToStaticMarkup(<ErrorList errors={[group({ sampleTraceId: null })]} />);
    expect(html).not.toMatch(/Trace/i);
    // Never a link to a base-less /trace/ — no fabricated id.
    expect(html).not.toContain("/trace/");
  });

  it("empty → honest per-filter empty state, no fabricated rows", () => {
    const html = renderToStaticMarkup(
      <ErrorList errors={[]} emptyTitle="No open errors" emptyDescription="Errors that are still recurring will appear here." />
    );
    expect(html).toContain("No open errors");
    expect(html).toContain("Errors that are still recurring will appear here.");
    expect(html).not.toContain("TypeError");
  });
});
