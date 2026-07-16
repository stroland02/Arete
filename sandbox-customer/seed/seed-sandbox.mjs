// Sandbox Customer DB seed (TEST DATA tooling).
//
// Populates the Kuma database with the Beancount fake customer so /overview,
// the agents pages, the Master Grid, and connectors render REAL activity
// instead of empty states. Two layers:
//
//   buildSandboxSeedData({ owner, sentry, posthog, now })  — PURE. Returns the
//     full seed payload from the telemetry fixtures. No DB, unit-testable.
//   seedSandbox(prisma, { owner, callSeedDevUser })         — idempotent upserts
//     of that payload into Postgres via the @arete/db Prisma client.
//
// Approach (b): this is a STANDALONE module. It best-effort calls Fable's
// seedDevUser when present so Installation.owner matches the dev session's
// authorized GitHub login (see sandbox-customer/README.md). It never modifies
// Fable's file.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// The six specialist ids from packages/dashboard/.../agents/agent-catalog.ts.
// A ReviewComment.category MUST be one of these — the id IS the agent tile.
export const AGENT_CATEGORIES = [
  "security",
  "performance",
  "quality",
  "test_coverage",
  "deployment_safety",
  "business_logic",
];

// severity values the dashboard understands (queries.ts): 'error' is what
// criticalBugs counts; 'warning'/'info' are non-critical.
const SANDBOX_EXTERNAL_ID = 990001; // synthetic GitHub installation id (test)
const REPO_EXTERNAL_ID = 990101; // synthetic GitHub repository id (test)

/** Coerce a fixture metrics object to the Record<string, number> the grid expects. */
function numericMetrics(metrics) {
  return Object.fromEntries(
    Object.entries(metrics ?? {}).filter(([, v]) => typeof v === "number"),
  );
}

/** Flatten the fixture's links object to the string[] getMasterGridSnapshots reads. */
function linkList(links) {
  return Object.values(links ?? {}).filter((v) => typeof v === "string");
}

/**
 * Build the complete, DB-free seed payload for the sandbox customer.
 * `now` is injectable for deterministic tests.
 */
export function buildSandboxSeedData({ owner, sentry, posthog, now = new Date() }) {
  const fullName = `${owner}/beancount`;
  const day = 24 * 60 * 60 * 1000;
  const iso = (offsetDays) => new Date(now.getTime() - offsetDays * day);

  const installation = {
    provider: "github",
    externalId: SANDBOX_EXTERNAL_ID,
    owner,
  };

  const repository = {
    provider: "github",
    externalId: REPO_EXTERNAL_ID,
    name: "beancount",
    fullName,
  };

  const reviews = [
    {
      prNumber: 7,
      headSha: "sandbox07aa11",
      riskLevel: "high",
      analysisStatus: "complete",
      createdAt: iso(0),
      overallSummary:
        "High risk: a SQL injection in expense search and an off-by-one that drops the first page of results, plus an O(n^2) report rollup that matches the p95 regression in production telemetry.",
      comments: [
        {
          category: "security",
          severity: "error",
          path: "app/api/expenses.ts",
          line: 24,
          body: "SQL injection: `term` is concatenated straight into the query in searchExpenses. Use a parameterized query / bound placeholder instead.",
        },
        {
          category: "quality",
          severity: "error",
          path: "app/api/expenses.ts",
          line: 15,
          body: "Off-by-one: page is 1-indexed but offset = page * limit, so page 1 skips the first `limit` rows. Use offset = (page - 1) * limit.",
        },
        {
          category: "performance",
          severity: "warning",
          path: "app/api/reports.ts",
          line: 18,
          body: "O(n^2): summarize re-filters the full expense list once per category. Build a single categoryId->total map in one pass. Matches Sentry BEAN-1043 (p95 > 1200ms).",
        },
        {
          category: "test_coverage",
          severity: "warning",
          path: "app/api/__tests__/reports.test.ts",
          line: 34,
          body: "Flaky test: buckets on `new Date()` and compares local getMonth() to a UTC-stamped date. Fails across midnight / non-UTC timezones. Freeze the clock or use a fixed date.",
        },
        {
          category: "business_logic",
          severity: "warning",
          path: "app/api/expenses.ts",
          line: 22,
          body: "Production signal: PostHog shows a funnel drop on the search step correlating with search_error_shown events — the injection-prone path is also the one users are hitting errors on.",
        },
        {
          category: "deployment_safety",
          severity: "info",
          path: "app/api/server.ts",
          line: 40,
          body: "No health endpoint or graceful shutdown on the server — fine for now, but add before this fronts a load balancer so rollouts don't drop in-flight requests.",
        },
      ],
      approvalPrompts: [
        {
          command: "kubectl rollout restart deploy/beancount-api -n sandbox",
          reason:
            "Clear the saturated DB connection pool behind the GET /reports/summary p95 regression (Sentry BEAN-1043) while the O(n^2) rollup fix ships.",
          status: "PENDING",
        },
      ],
    },
    {
      prNumber: 5,
      headSha: "sandbox05bb22",
      riskLevel: "medium",
      analysisStatus: "complete",
      createdAt: iso(2),
      overallSummary:
        "Medium risk: naming and a missing test around the new category rollup. No security or correctness blockers.",
      comments: [
        {
          category: "quality",
          severity: "warning",
          path: "app/api/reports.ts",
          line: 30,
          body: "topExpense returns the first max on ties non-deterministically depending on input order — document or make the tie-break explicit.",
        },
        {
          category: "test_coverage",
          severity: "info",
          path: "app/api/reports.ts",
          line: 18,
          body: "summarize has no test for the empty-expenses case (should return every category at 0, not an empty array).",
        },
      ],
      approvalPrompts: [],
    },
    {
      prNumber: 3,
      headSha: "sandbox03cc33",
      riskLevel: "low",
      analysisStatus: "complete",
      createdAt: iso(5),
      overallSummary: "Low risk: minor hardening note, nothing blocking.",
      comments: [
        {
          category: "security",
          severity: "info",
          path: "app/data/db.ts",
          line: 38,
          body: "rawQuery accepts arbitrary SQL strings — safe today because inputs are internal, but constrain it to a query builder before any user-facing caller reaches it.",
        },
      ],
      approvalPrompts: [],
    },
  ];

  const telemetry = {
    connections: [
      {
        provider: "sentry",
        config: { project: sentry.sourceRef },
        // TEST DATA placeholder — no real Sentry credential. Live re-fetch
        // needs a real key (deploy/v2); v1 renders from the seeded snapshot.
        credentials: "TEST-DATA-no-real-credential",
        authMethod: "api_key",
      },
      {
        provider: "posthog",
        config: { project: posthog.sourceRef },
        credentials: "TEST-DATA-no-real-credential",
        authMethod: "api_key",
      },
    ],
    snapshots: [
      {
        provider: sentry.provider,
        sourceRef: sentry.sourceRef,
        summaryText: sentry.summaryText,
        metrics: numericMetrics(sentry.metrics),
        links: linkList(sentry.links),
        fetchedAt: new Date(sentry.fetchedAt),
      },
      {
        provider: posthog.provider,
        sourceRef: posthog.sourceRef,
        summaryText: posthog.summaryText,
        metrics: numericMetrics(posthog.metrics),
        links: linkList(posthog.links),
        fetchedAt: new Date(posthog.fetchedAt),
      },
    ],
  };

  return { installation, repository, reviews, telemetry };
}

/** Load and parse the two telemetry fixtures from disk. */
export async function loadFixtures() {
  const root = join(HERE, "..", "telemetry-fixtures");
  const [sentry, posthog] = await Promise.all([
    readFile(join(root, "sentry-issues.json"), "utf8").then(JSON.parse),
    readFile(join(root, "posthog-metrics.json"), "utf8").then(JSON.parse),
  ]);
  return { sentry, posthog };
}

/**
 * Idempotently upsert the sandbox payload into the Kuma DB. Re-running never
 * duplicates: Installation/Repository/Review upsert on their natural keys, and
 * a review's comments/approvals are replaced (deleteMany + create) each run.
 */
export async function seedSandbox(prisma, { owner, callSeedDevUser = true } = {}) {
  let resolvedOwner = owner ?? process.env.SANDBOX_OWNER ?? "kuma-sandbox";

  if (callSeedDevUser) {
    const devLogin = await trySeedDevUser();
    if (devLogin) {
      resolvedOwner = devLogin;
      console.log(`[seed] Using dev login from seedDevUser as owner: ${resolvedOwner}`);
    } else {
      console.warn(
        `[seed] seedDevUser not found on-branch. Falling back to owner="${resolvedOwner}". ` +
          "/overview will only show this installation once its owner matches a GitHub login " +
          "the dev session is authorized for (see README).",
      );
    }
  }

  const { sentry, posthog } = await loadFixtures();
  const data = buildSandboxSeedData({ owner: resolvedOwner, sentry, posthog });

  const installation = await prisma.installation.upsert({
    where: { provider_externalId: { provider: "github", externalId: data.installation.externalId } },
    create: { ...data.installation },
    update: { owner: data.installation.owner },
  });

  const repository = await prisma.repository.upsert({
    where: { provider_externalId: { provider: "github", externalId: data.repository.externalId } },
    create: { ...data.repository, installationId: installation.id },
    update: { name: data.repository.name, fullName: data.repository.fullName, installationId: installation.id },
  });

  for (const review of data.reviews) {
    const row = await prisma.review.upsert({
      where: {
        repositoryId_prNumber_headSha: {
          repositoryId: repository.id,
          prNumber: review.prNumber,
          headSha: review.headSha,
        },
      },
      create: {
        prNumber: review.prNumber,
        headSha: review.headSha,
        riskLevel: review.riskLevel,
        overallSummary: review.overallSummary,
        analysisStatus: review.analysisStatus,
        createdAt: review.createdAt,
        repositoryId: repository.id,
      },
      update: {
        riskLevel: review.riskLevel,
        overallSummary: review.overallSummary,
        analysisStatus: review.analysisStatus,
      },
    });

    // Replace children so re-runs stay idempotent.
    await prisma.reviewComment.deleteMany({ where: { reviewId: row.id } });
    if (review.comments.length > 0) {
      await prisma.reviewComment.createMany({
        data: review.comments.map((c) => ({ ...c, reviewId: row.id })),
      });
    }
    await prisma.approvalPrompt.deleteMany({ where: { reviewId: row.id } });
    for (const ap of review.approvalPrompts) {
      await prisma.approvalPrompt.create({ data: { ...ap, reviewId: row.id } });
    }
  }

  for (const conn of data.telemetry.connections) {
    await prisma.telemetryConnection.upsert({
      where: { installationId_provider: { installationId: installation.id, provider: conn.provider } },
      create: { ...conn, installationId: installation.id },
      update: { config: conn.config },
    });
  }

  for (const snap of data.telemetry.snapshots) {
    await prisma.telemetrySnapshotRecord.upsert({
      where: {
        installationId_provider_sourceRef: {
          installationId: installation.id,
          provider: snap.provider,
          sourceRef: snap.sourceRef,
        },
      },
      create: { ...snap, installationId: installation.id },
      update: {
        summaryText: snap.summaryText,
        metrics: snap.metrics,
        links: snap.links,
        fetchedAt: snap.fetchedAt,
      },
    });
  }

  return {
    installationId: installation.id,
    repositoryId: repository.id,
    owner: resolvedOwner,
    reviews: data.reviews.length,
    findings: data.reviews.reduce((n, r) => n + r.comments.length, 0),
  };
}

/** Best-effort dynamic import + call of Fable's dev-user seed. Returns a login or null. */
async function trySeedDevUser() {
  try {
    const mod = await import("../../packages/dashboard/scripts/seed-dev-user.mjs");
    const fn = mod.seedDevUser ?? mod.default;
    if (typeof fn !== "function") return null;
    const result = await fn();
    // Tolerate several return shapes; we only need a GitHub login/owner string.
    return result?.login ?? result?.owner ?? result?.user?.login ?? null;
  } catch {
    return null;
  }
}

// CLI entry: node sandbox-customer/seed/seed-sandbox.mjs
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seed-sandbox.mjs")) {
  const prisma = await getPrisma();
  try {
    const summary = await seedSandbox(prisma, {});
    console.log("[seed] Sandbox customer seeded:", summary);
  } finally {
    await prisma?.$disconnect?.();
  }
}

/** Resolve a PrismaClient from @arete/db. Documented requirement: run from repo root. */
async function getPrisma() {
  try {
    const mod = await import("@arete/db");
    const Client = mod.PrismaClient ?? mod.default?.PrismaClient;
    if (!Client) throw new Error("PrismaClient not exported by @arete/db");
    return new Client();
  } catch (err) {
    console.error(
      "[seed] Could not load the @arete/db Prisma client. Run this from the repo root " +
        "(so workspace resolution works) with a valid DATABASE_URL. Original error:",
      err.message ?? err,
    );
    process.exit(1);
  }
}
