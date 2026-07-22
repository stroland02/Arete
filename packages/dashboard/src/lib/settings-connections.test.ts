import { describe, it, expect } from "vitest";
import type { AccountState } from "@/lib/account-state";
import {
  deriveConnectionsSummary,
  NOT_CONNECTED,
  MAX_LISTED_ITEMS,
  type ConnectionsSummaryInput,
} from "./settings-connections";

// State matrix for the Settings → Connections summary. It must obey the
// Account-State Contract (docs/superpowers/specs/2026-07-17-account-state-contract.md):
// real facts only, and "connected but idle" is a POPULATED state that must
// never collapse into "not connected".

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

const input = (over: Partial<ConnectionsSummaryInput> = {}): ConnectionsSummaryInput => ({
  accountState: state(),
  repositories: [],
  telemetryProviders: [],
  activeModel: null,
  ...over,
});

const rowById = (summary: ReturnType<typeof deriveConnectionsSummary>, id: string) => {
  const row = summary.rows.find((r) => r.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
};

describe("deriveConnectionsSummary", () => {
  it("nothing connected → every row says so explicitly, nothing is invented", () => {
    const s = deriveConnectionsSummary(input());
    expect(s.rows.map((r) => r.id)).toEqual(["repositories", "ai-model", "services"]);
    expect(s.connectedCount).toBe(0);
    expect(s.totalCount).toBe(3);
    expect(s.stage).toBe("disconnected");
    for (const row of s.rows) {
      expect(row.connected).toBe(false);
      // The honesty law: stated as not connected — never blank, never a
      // plausible-looking value standing in for a real one.
      expect(row.status).toBe(NOT_CONNECTED);
      expect(row.status.trim().length).toBeGreaterThan(0);
      expect(row.items).toEqual([]);
      expect(row.idle).toBe(false);
      expect(row.actionLabel.startsWith("Connect")).toBe(true);
      expect(row.href.startsWith("/connections")).toBe(true);
    }
  });

  it("a not-connected row never yields a value that could read as connected", () => {
    // Every disconnected permutation of the other signals: the disconnected row
    // must never pick up a name, a count, or connected-sounding copy.
    const permutations: ConnectionsSummaryInput[] = [
      input(),
      input({ repositories: ["acme/api"], telemetryProviders: ["posthog"] }), // stale lists, resolver says nothing is connected
      input({ accountState: state({ hasReviews: true, reviewCount: 4 }) }), // activity without connection
    ];
    for (const perm of permutations) {
      const s = deriveConnectionsSummary(perm);
      for (const row of s.rows) {
        if (row.connected) continue;
        expect(row.status).toBe(NOT_CONNECTED);
        expect(row.items).toHaveLength(0);
        expect(row.status).not.toMatch(/\d/); // no fabricated count
        expect(row.status).not.toMatch(/·/); // no fabricated provider · model
        expect(row.status).not.toMatch(/^Connected/);
        expect(row.actionLabel).not.toMatch(/^Manage/);
      }
    }
  });

  it("repo connected but no model → repositories connected, model row still explicitly not connected", () => {
    const s = deriveConnectionsSummary(
      input({
        accountState: state({
          repoConnected: true,
          repoCount: 1,
          stage: "connected_idle",
        }),
        repositories: ["acme/api"],
      })
    );
    const repos = rowById(s, "repositories");
    expect(repos.connected).toBe(true);
    expect(repos.items).toEqual(["acme/api"]);
    expect(repos.status).toContain("1 repository connected");
    expect(repos.actionLabel).toBe("Manage repositories");

    const model = rowById(s, "ai-model");
    expect(model.connected).toBe(false);
    expect(model.status).toBe(NOT_CONNECTED);
    expect(model.href).toBe("/connections/ai-models");
    expect(s.connectedCount).toBe(1);
  });

  it("repo + model connected with no reviews → connected-idle is POPULATED, never 'not connected'", () => {
    const s = deriveConnectionsSummary(
      input({
        accountState: state({
          repoConnected: true,
          repoCount: 2,
          modelConnected: true,
          hasReviews: false,
          stage: "connected_idle",
        }),
        repositories: ["acme/api", "acme/web"],
        activeModel: { provider: "anthropic", model: "claude-opus-4-8" },
      })
    );
    const repos = rowById(s, "repositories");
    expect(repos.connected).toBe(true); // populated, not empty
    expect(repos.idle).toBe(true);
    expect(repos.status).toBe("2 repositories connected — no reviews yet");
    expect(repos.status).not.toBe(NOT_CONNECTED);
    expect(repos.actionLabel).toBe("Manage repositories"); // never "Connect a repository"
    expect(repos.items).toEqual(["acme/api", "acme/web"]);

    const model = rowById(s, "ai-model");
    expect(model.connected).toBe(true);
    expect(model.status).toBe("Anthropic · claude-opus-4-8"); // the real provider + model
    expect(s.stage).toBe("connected_idle");
    expect(s.connectedCount).toBe(2);
  });

  it("reviews exist → the repositories row drops the idle qualifier", () => {
    const s = deriveConnectionsSummary(
      input({
        accountState: state({
          repoConnected: true,
          repoCount: 1,
          hasReviews: true,
          reviewCount: 3,
          stage: "active",
        }),
        repositories: ["acme/api"],
      })
    );
    const repos = rowById(s, "repositories");
    expect(repos.idle).toBe(false);
    expect(repos.status).toBe("1 repository connected");
  });

  it("installation authorized but nothing indexed yet → connected, honestly empty of names", () => {
    const s = deriveConnectionsSummary(
      input({
        accountState: state({ repoConnected: true, repoCount: 0, stage: "connected_idle" }),
        repositories: [],
      })
    );
    const repos = rowById(s, "repositories");
    expect(repos.connected).toBe(true);
    expect(repos.idle).toBe(true);
    expect(repos.status).toBe("Connected — no repositories indexed yet");
    expect(repos.items).toEqual([]); // no invented repository name
  });

  it("telemetry providers connected → real catalog labels, unknown ids pass through raw", () => {
    const s = deriveConnectionsSummary(
      input({
        accountState: state({
          repoConnected: true,
          repoCount: 1,
          telemetryConnected: true,
          stage: "connected_idle",
        }),
        repositories: ["acme/api"],
        telemetryProviders: ["posthog", "github-actions"],
      })
    );
    const services = rowById(s, "services");
    expect(services.connected).toBe(true);
    expect(services.status).toBe("2 services connected");
    expect(services.items).toEqual(["PostHog", "GitHub Actions"]);
    expect(services.actionLabel).toBe("Manage services");

    const unknown = deriveConnectionsSummary(
      input({
        accountState: state({ telemetryConnected: true }),
        telemetryProviders: ["some-new-provider"],
      })
    );
    expect(rowById(unknown, "services").items).toEqual(["some-new-provider"]);
  });

  it("resolver says connected but no names were handed over → says so, invents nothing", () => {
    const s = deriveConnectionsSummary(
      input({
        accountState: state({ modelConnected: true, telemetryConnected: true }),
        activeModel: null,
        telemetryProviders: [],
      })
    );
    const model = rowById(s, "ai-model");
    expect(model.connected).toBe(true);
    expect(model.status).toBe("Connected — model details unavailable");

    const services = rowById(s, "services");
    expect(services.connected).toBe(true);
    expect(services.status).toBe("Connected — service details unavailable");
    expect(services.items).toEqual([]);
  });

  it("long repository lists truncate honestly with a real remainder count", () => {
    const repositories = ["acme/a", "acme/b", "acme/c", "acme/d", "acme/e"];
    const s = deriveConnectionsSummary(
      input({
        accountState: state({
          repoConnected: true,
          repoCount: repositories.length,
          hasReviews: true,
          stage: "active",
        }),
        repositories,
      })
    );
    const repos = rowById(s, "repositories");
    expect(repos.status).toBe("5 repositories connected"); // the FULL count is never hidden
    expect(repos.items).toHaveLength(MAX_LISTED_ITEMS + 1);
    expect(repos.items.slice(0, MAX_LISTED_ITEMS)).toEqual(repositories.slice(0, MAX_LISTED_ITEMS));
    expect(repos.items.at(-1)).toBe(`+${repositories.length - MAX_LISTED_ITEMS} more`);
    // Exactly at the limit → no "+N more" marker at all.
    const exact = deriveConnectionsSummary(
      input({
        accountState: state({ repoConnected: true, repoCount: 3, hasReviews: true, stage: "active" }),
        repositories: repositories.slice(0, MAX_LISTED_ITEMS),
      })
    );
    expect(rowById(exact, "repositories").items).toEqual(repositories.slice(0, MAX_LISTED_ITEMS));
  });

  it("every row is total: a status and an action label in all 2^4 signal combinations", () => {
    const bools = [false, true];
    for (const repoConnected of bools)
      for (const modelConnected of bools)
        for (const hasReviews of bools)
          for (const telemetryConnected of bools) {
            const s = deriveConnectionsSummary(
              input({
                accountState: state({
                  repoConnected,
                  repoCount: repoConnected ? 1 : 0,
                  modelConnected,
                  hasReviews,
                  telemetryConnected,
                  stage: repoConnected ? (hasReviews ? "active" : "connected_idle") : "disconnected",
                }),
                repositories: repoConnected ? ["acme/api"] : [],
                telemetryProviders: telemetryConnected ? ["posthog"] : [],
                activeModel: modelConnected ? { provider: "ollama", model: "qwen2.5-coder" } : null,
              })
            );
            expect(s.rows).toHaveLength(3);
            for (const row of s.rows) {
              expect(row.status.length).toBeGreaterThan(0);
              expect(row.actionLabel.length).toBeGreaterThan(0);
              // Idle only ever qualifies a row that IS connected.
              if (row.idle) expect(row.connected).toBe(true);
            }
            expect(s.connectedCount).toBe(
              [repoConnected, modelConnected, telemetryConnected].filter(Boolean).length
            );
          }
  });
});
