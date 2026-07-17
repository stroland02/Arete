// DB-free verification of the sandbox seed payload (TEST DATA tooling).
//
// This is the honest, infra-free check: it validates that buildSandboxSeedData
// produces a payload the Kuma dashboard can actually render — categories that
// map to real agent tiles, at least one critical finding, telemetry links as
// string[], numeric metrics, and the review keys the DB upserts rely on.
// It does NOT touch a database (that needs Postgres — see README).
//
// Run:  node --test sandbox-customer/seed/seed-sandbox.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_CATEGORIES,
  buildSandboxSeedData,
  loadFixtures,
} from "./seed-sandbox.mjs";

const OWNER = "kuma-sandbox";
const NOW = new Date("2026-07-15T12:00:00.000Z");

async function build() {
  const { sentry, posthog } = await loadFixtures();
  return buildSandboxSeedData({ owner: OWNER, sentry, posthog, now: NOW });
}

test("installation and repository are stamped with the given owner", async () => {
  const data = await build();
  assert.equal(data.installation.owner, OWNER);
  assert.equal(data.installation.provider, "github");
  assert.equal(data.repository.fullName, `${OWNER}/beancount`);
});

test("every finding category maps to a real agent tile", async () => {
  const data = await build();
  const categories = data.reviews.flatMap((r) => r.comments.map((c) => c.category));
  assert.ok(categories.length > 0, "expected some findings");
  for (const category of categories) {
    assert.ok(
      AGENT_CATEGORIES.includes(category),
      `category "${category}" is not one of the six agent ids`,
    );
  }
});

test("all six agent tiles are covered so none render empty", async () => {
  const data = await build();
  const categories = new Set(data.reviews.flatMap((r) => r.comments.map((c) => c.category)));
  for (const agent of AGENT_CATEGORIES) {
    assert.ok(categories.has(agent), `no finding for agent tile "${agent}"`);
  }
});

test("at least one critical (severity=error) finding so criticalBugs is non-zero", async () => {
  const data = await build();
  const errors = data.reviews.flatMap((r) => r.comments).filter((c) => c.severity === "error");
  assert.ok(errors.length >= 1, "expected at least one severity=error finding");
});

test("each review has the composite-key fields the DB upsert needs", async () => {
  const data = await build();
  for (const r of data.reviews) {
    assert.equal(typeof r.prNumber, "number");
    assert.equal(typeof r.headSha, "string");
    assert.ok(r.headSha.length > 0);
    assert.ok(r.createdAt instanceof Date);
  }
});

test("there is a PENDING approval prompt to exercise the HITL/apply path", async () => {
  const data = await build();
  const prompts = data.reviews.flatMap((r) => r.approvalPrompts);
  assert.ok(prompts.some((p) => p.status === "PENDING" && p.command.length > 0));
});

test("telemetry snapshots have string[] links and numeric-only metrics", async () => {
  const data = await build();
  assert.equal(data.telemetry.snapshots.length, 2);
  for (const snap of data.telemetry.snapshots) {
    assert.ok(Array.isArray(snap.links), "links must be an array (grid reads string[])");
    for (const link of snap.links) assert.equal(typeof link, "string");
    for (const value of Object.values(snap.metrics)) {
      assert.equal(typeof value, "number", "metrics must be Record<string, number>");
    }
    assert.ok(snap.fetchedAt instanceof Date);
  }
});

test("both telemetry providers are connected so connectors are not empty", async () => {
  const data = await build();
  const providers = data.telemetry.connections.map((c) => c.provider).sort();
  assert.deepEqual(providers, ["posthog", "sentry"]);
});
