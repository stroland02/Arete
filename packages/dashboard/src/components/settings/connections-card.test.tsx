import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionsCard } from "./connections-card";
import type { AccountState } from "@/lib/account-state";
import {
  deriveConnectionsSummary,
  type ConnectionsSummaryInput,
} from "@/lib/settings-connections";

// The Settings Connections card renders ONLY what the account really has
// connected. It summarizes and links; it never manages, and it never invents a
// value to fill a row (Account-State Contract, §3 anti-fabrication).

const state = (over: Partial<AccountState> = {}): AccountState => ({
  repoConnected: false,
  repoCount: 0,
  modelConnected: false,
  hasReviews: false,
  reviewCount: 0,
  scanCompleted: false,
  telemetryConnected: false,
  stage: "disconnected",
  ...over,
});

const summary = (over: Partial<ConnectionsSummaryInput> = {}) =>
  deriveConnectionsSummary({
    accountState: state(),
    repositories: [],
    telemetryProviders: [],
    activeModel: null,
    ...over,
  });

describe("ConnectionsCard", () => {
  it("renders the real repositories, model and services when they are connected", () => {
    const html = renderToStaticMarkup(
      <ConnectionsCard
        summary={summary({
          accountState: state({
            repoConnected: true,
            repoCount: 2,
            modelConnected: true,
            hasReviews: true,
            reviewCount: 5,
            telemetryConnected: true,
            stage: "active",
          }),
          repositories: ["acme/api", "acme/web"],
          telemetryProviders: ["posthog"],
          activeModel: { provider: "anthropic", model: "claude-opus-4-8" },
        })}
      />
    );
    expect(html).toContain("Connections");
    expect(html).toContain("acme/api");
    expect(html).toContain("acme/web");
    expect(html).toContain("claude-opus-4-8");
    expect(html).toContain("Anthropic");
    expect(html).toContain("PostHog");
    expect(html).toContain("3 of 3 connected");
    // Links out to the management home — it never manages inline.
    expect(html).toContain('href="/connections"');
    expect(html).toContain('href="/connections/ai-models"');
    expect(html).toContain("Manage repositories");
    expect(html).not.toContain("Not connected");
  });

  it("renders explicit not-connected copy and connect CTAs when nothing is connected", () => {
    const html = renderToStaticMarkup(<ConnectionsCard summary={summary()} />);
    expect(html).toContain("Not connected");
    expect(html).toContain("Connect a repository");
    expect(html).toContain("Connect an AI model");
    expect(html).toContain("Connect a service");
    expect(html).toContain("0 of 3 connected");
    expect(html).not.toContain("Manage repositories");
  });

  it("does NOT render a fabricated placeholder for an unconnected row", () => {
    const html = renderToStaticMarkup(<ConnectionsCard summary={summary()} />);
    // No sample repo, no sample model, no invented provider — the classics.
    expect(html).not.toMatch(/acme\//);
    expect(html).not.toMatch(/owner\/repo/);
    expect(html).not.toMatch(/example/i);
    expect(html).not.toMatch(/claude-/);
    expect(html).not.toMatch(/PostHog|Vercel|Stripe/);
    expect(html).not.toMatch(/—\s*<\/span>/); // no em-dash placeholder standing in for a value
  });

  it("shows a connected repo with no reviews as CONNECTED and idle — never 'not connected'", () => {
    const html = renderToStaticMarkup(
      <ConnectionsCard
        summary={summary({
          accountState: state({
            repoConnected: true,
            repoCount: 1,
            stage: "connected_idle",
          }),
          repositories: ["acme/api"],
        })}
      />
    );
    expect(html).toContain("acme/api");
    expect(html).toContain("1 repository connected");
    expect(html).toContain("no reviews yet");
    expect(html).toContain("Connected · idle");
    expect(html).toContain("Manage repositories");
    expect(html).not.toContain("Connect a repository");
    // The still-unconnected rows remain honest in the same render.
    expect(html).toContain("Connect an AI model");
    expect(html).toContain("1 of 3 connected");
  });

  it("truncates a long repository list with the honest remainder, not with invented names", () => {
    const html = renderToStaticMarkup(
      <ConnectionsCard
        summary={summary({
          accountState: state({
            repoConnected: true,
            repoCount: 5,
            hasReviews: true,
            reviewCount: 1,
            stage: "active",
          }),
          repositories: ["acme/a", "acme/b", "acme/c", "acme/d", "acme/e"],
        })}
      />
    );
    expect(html).toContain("5 repositories connected");
    expect(html).toContain("+2 more");
    expect(html).not.toContain("acme/d");
    expect(html).not.toContain("acme/e");
  });
});
