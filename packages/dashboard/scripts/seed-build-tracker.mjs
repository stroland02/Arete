#!/usr/bin/env node
/**
 * Emit `packages/dashboard/data/build-tracker.json` from this lane's catalogue.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three project managers were given the same "master build status" prompt in
 * three workspaces, so three lanes built the same feature:
 *
 *   - `pyrosome`  — declared the schema + seed claim on 2026-07-22 and wrote
 *                   `src/lib/build-tracker/{schema,parse,select,mutate}.ts`.
 *   - `nautilus`  — this lane. Declared 2026-07-23. Did the documentation sweep
 *                   and catalogued 85 items with provenance.
 *   - a third     — pushed `origin/feat/master-build-status` @ d6bf492, which
 *                   extends `feature-readiness.ts` instead.
 *
 * `pyrosome`'s coordination entry sets the tiebreak: "First declaration wins;
 * the tiebreak is the earlier `declared` date." Theirs is earlier, so THIS LANE
 * DEFERS. Their schema is the contract, and this script converts the catalogue
 * into it rather than shipping a second, incompatible seed.
 *
 * That resolves the collision the right way round: the code is mechanical and
 * cheap, the catalogue is what took the sweep. They own the shape; we hand over
 * the contents.
 *
 * Run:  node packages/dashboard/scripts/seed-build-tracker.mjs
 * It self-validates against the documented contract and refuses to write on any
 * violation.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const SOURCE = join(REPO, "docs", "roadmap", "master-build-status.json");
const TARGET = join(REPO, "packages", "dashboard", "data", "build-tracker.json");

const SEEDED_AT = "2026-07-23";

// ---------------------------------------------------------------- vocabularies
// Mirrors packages/dashboard/src/lib/build-tracker/schema.ts (pyrosome lane).
const AREAS = ["Product surfaces", "Built, but unreachable", "Partially wired", "Not built yet"];
const LEVELS = ["live", "preview", "partial", "soon"];
const LANES = ["inventory", "idea"];
const STATES = ["shipped", "in-progress", "next", "someday", "blocked", "needs-decision", "dropped"];
const IMPORTANCE = ["critical", "high", "medium", "low"];
const ORIGINS = ["audit", "roadmap", "session", "user"];
const AUTHORS = ["seed", "user", "agent"];
const STANDINGS = ["current", "stale", "superseded", "complete"];
const PHASE_STATES = ["done", "in-progress", "not-started", "deferred", "stale"];

/**
 * The rows the build-status page has always shown. `lane: "inventory"` means
 * "an audited product surface"; everything else is an `idea` — proposed and
 * recorded, never started. Listed by id rather than derived, because the
 * distinction is a fact about the old page, not something recomputable.
 * Source: the pre-migration `lib/feature-readiness.ts` (25 entries).
 */
const INVENTORY_IDS = new Set([
  "surface-ai-models",
  "surface-review-history",
  "surface-incidents",
  "surface-settings",
  "surface-overview",
  "surface-agents",
  "surface-services",
  "surface-incident-detail",
  "surface-connections",
  "surface-search-notifications",
  "approvals-panel",
  "outbound-webhook-management-ui",
  "agent-memory-ui",
  "live-throughput-metrics",
  "tracing-and-log-search",
  "confidence-on-review-findings",
  "silence-a-finding",
  "telemetry-freshness-poller",
  "mcp-servers-no-surface",
  "relays-slack-linear-pagerduty",
  "public-api-and-keys",
  "review-scope-filters",
  "kuma-as-mcp-server",
  "tenant-telemetry-ingest",
]);

const IMPORTANCE_BY_PRIORITY = { P0: "critical", P1: "high", P2: "medium", P3: "low" };

/** Items whose blocker is a judgement call we owe ourselves, not an external dependency. */
const NEEDS_DECISION_IDS = new Set([
  "python-fingerprint-decision",
  "revert-or-subsume-agents-rail-inbox",
  "parked-review-comment-indexes",
]);

/**
 * `status` (this lane) → `state` (pyrosome's contract).
 *
 * `open` splits on importance rather than collapsing: P0/P1 open work is `next`,
 * P2/P3 open work is `someday`. Calling a P3 idea "next" would overstate the
 * queue, which is the small dishonesty the tracker exists to avoid.
 */
function toState(item) {
  switch (item.status) {
    case "shipped":
      return "shipped";
    case "in_progress":
      return "in-progress";
    case "blocked":
      return "blocked";
    case "deferred":
      return "someday";
    case "not_schedulable":
      return NEEDS_DECISION_IDS.has(item.id) ? "needs-decision" : "blocked";
    case "open":
      return item.priority === "P0" || item.priority === "P1" ? "next" : "someday";
    default:
      throw new Error(`unmapped status: ${item.status}`);
  }
}

/** How the item got here. Derived from which sweep recorded it, so it stays checkable. */
const ORIGIN_BY_ADDED_BY = {
  "build-status-map": "audit",
  "ridley-closeout": "audit",
  "orchestration-briefs": "audit",
  backlog: "roadmap",
  nautilus: "session",
};

/**
 * The four numbering systems this repo actually runs, kept separate.
 *
 * Merging them would invent a progression that does not exist — product 1.x,
 * SuperLog P1-P5, observability 0-4 and orchestration A-C are different axes.
 * Items outside all four carry NO programme ref rather than a fabricated one.
 */
const PROGRAMMES = [
  {
    id: "reachability",
    label: "Reachability & Consolidation",
    standing: "current",
    caveat:
      "The live sequencing document. Stage 1 is largely shipped; Stages 2-5 are unstarted. Its own text records that three of its items turned out to be builds rather than the wiring it predicted.",
    source: "docs/superpowers/plans/2026-07-23-reachability-and-consolidation-roadmap.md",
    phases: [
      {
        key: "stage-1",
        label: "Stage 1 - make the built product reachable",
        state: "in-progress",
        evidence: "1192d37 (1.1, 1.2); 1.3 and 1.4 shipped; 1.5 blocked on Sentry's approval",
      },
      { key: "stage-2", label: "Stage 2 - Agents become a layer inside Services", state: "not-started" },
      { key: "stage-3", label: "Stage 3 - papercuts and the refresh", state: "not-started" },
      { key: "stage-4", label: "Stage 4 - hygiene that keeps the map honest", state: "not-started" },
      { key: "stage-5", label: "Stage 5 - the bigger bets", state: "not-started" },
    ],
  },
  {
    id: "observability",
    label: "SUPERLOG observability",
    standing: "current",
    caveat:
      "Phases 0, 1, 2 and 4 closed with gate reports. Phase 2b was split out of Phase 2 and its first item is a live security gap, not an enhancement. Phase 3 is deliberately deferred.",
    source: "docs/roadmap/backlog.md",
    phases: [
      { key: "0", label: "Phase 0 - foundations", state: "done" },
      { key: "1", label: "Phase 1 - observability integration", state: "done" },
      {
        key: "2",
        label: "Phase 2 - healing-agent upgrade + alerting",
        state: "done",
        evidence: ".superpowers/sdd/phase-2-gate-report.md",
      },
      { key: "2b", label: "Phase 2b - deferred from Phase 2", state: "not-started" },
      { key: "3", label: "Phase 3 - tenant telemetry platform", state: "deferred" },
      { key: "4", label: "Phase 4 - trustworthy CI signal + harness hardening", state: "done" },
    ],
  },
  {
    id: "product",
    label: "Product roadmap (P1-P4)",
    standing: "stale",
    caveat:
      "STALE - this numbering lists work as unstarted that is closed in code (the approval-exec consumer, memory write-back and the review-heavy queue consumer were all recorded open after shipping). Correct it before planning off any number in this row.",
    source: "docs/status/2026-07-22-build-status-map.md §5",
    phases: [
      { key: "P1", label: "P1 - review product completeness", state: "in-progress" },
      { key: "P2", label: "P2 - relays and outbound integrations", state: "not-started" },
      { key: "P3", label: "P3 - public API and the MCP inversion", state: "not-started" },
      { key: "P4", label: "P4 - tenant telemetry platform", state: "deferred" },
    ],
  },
  {
    id: "orchestration",
    label: "Work-floor orchestration (A-C)",
    standing: "current",
    caveat:
      "Phase A shipped as packages/orchestration. Phase B is blocked on the Docker sandbox workspace agent - the one plan artifact of ~380 declared symbols that was never written.",
    source: "docs/superpowers/specs/2026-07-15-kuma-work-floor-orchestration-design.md",
    phases: [
      { key: "A", label: "Phase A - the work floor", state: "done" },
      {
        key: "B",
        label: "Phase B - repro / root-cause / fix-author / test-author / QA agents",
        state: "not-started",
      },
      { key: "C", label: "Phase C - autonomous drive", state: "not-started" },
    ],
  },
];

/** stage id (this lane) → reachability phase key. Stages with no counterpart are absent. */
const REACHABILITY_PHASE = {
  "stage-1": "stage-1",
  "stage-2": "stage-2",
  "stage-3": "stage-3",
  "stage-4": "stage-4",
  "stage-5": "stage-5",
};

/**
 * Per-item refs for items belonging to a numbering system OTHER than the
 * reachability roadmap. Hand-maintained and small on purpose: a guessed
 * programme ref is a fabricated claim about sequencing.
 */
const EXTRA_PROGRAMMES = {
  "internal-token-no-expiry": [{ programme: "observability", phase: "2b" }],
  "mcp-token-plaintext-and-simulated-oauth": [{ programme: "observability", phase: "2b" }],
  "prose-credentials-reach-sinks": [{ programme: "observability", phase: "2b" }],
  "tracing-and-log-search": [{ programme: "observability", phase: "2b" }],
  "agent-memory-cap-and-archive": [{ programme: "observability", phase: "2b" }],
  "review-scope-filters": [{ programme: "product", phase: "P1" }],
  "review-pr-url-and-reason-codes": [{ programme: "product", phase: "P1" }],
  "relays-slack-linear-pagerduty": [{ programme: "product", phase: "P2" }],
  "public-api-and-keys": [{ programme: "product", phase: "P3" }],
  "kuma-as-mcp-server": [{ programme: "product", phase: "P3" }],
  // Two refs on purpose: the same work is Phase 3 of observability AND P4 of
  // the product roadmap. Forcing one value is how the numberings got conflated.
  "tenant-telemetry-ingest": [
    { programme: "observability", phase: "3" },
    { programme: "product", phase: "P4" },
  ],
  "telemetry-freshness-poller": [{ programme: "observability", phase: "3" }],
  "work-floor-phase-b-agents": [{ programme: "orchestration", phase: "B" }],
  "docker-sandbox-workspace-agent": [{ programme: "orchestration", phase: "B" }],
};

/**
 * External blockers as `ext:` strings. These items are parked on something
 * outside the tracker; the contract wants that stated rather than left as an
 * unexplained `blocked`.
 */
const EXTERNAL_BLOCKERS = {
  "parked-anthropic-zero-balance": [
    "ext:the Anthropic account is at $0 - add credits or run on Ollama",
  ],
  "parked-haiku-fix-authoring-adequacy": [
    "ext:needs a funded provider key plus a regression corpus to measure",
  ],
  "parked-review-concurrency-tuning": ["ext:needs a real large PR and a funded key to measure"],
  "parked-review-job-double-retry": [
    "ext:needs a real induced transient provider failure mid-review",
  ],
  "parked-clickhouse-ttl-verification": [
    "ext:needs real aged data - every row here is hours old",
  ],
  "parked-error-severity-log": [
    "ext:needs an ERROR-severity row to exist; the dashboard exports traces only",
  ],
  "parked-signals-visibly-render": [
    "ext:needs a real Alertmanager alert - synthetic seeds are forbidden",
  ],
  "parked-mcp-rfc8414-discovery": [
    "ext:speculative until a real MCP server with no static token_url needs it",
  ],
  "parked-code-map-browser-qa": ["ext:a human browser pass a unit suite cannot stand in for"],
  "parked-review-comment-indexes": [
    "ext:needs EXPLAIN ANALYZE at scale before any index is added",
  ],
  "connect-sentry": ["ext:blocked on Sentry's own integration approval, not on us"],
  "google-oauth-client-missing": [
    "ext:the Google OAuth client was deleted upstream in Google Cloud Console",
  ],
};

const PRINCIPLES = [
  {
    id: "honesty-is-the-product",
    title: "Honesty is the product",
    body: "Never fabricate data, status or a passing result. Empty states say what is actually true, null (unavailable) is never [] (none), and a control that cannot act is disabled with its reason rather than a live-looking button.",
    source: "docs/handoff/2026-07-22-orchestration-briefs.md §0",
  },
  {
    id: "human-in-the-loop-moat",
    title: "The human-in-the-loop moat",
    body: "Nothing merges or posts autonomously. The fix driver never advances past ready; only a human approves, only a human sends. A refusal branch nothing can trigger is dead code pretending to be a safeguard.",
    source: "docs/superpowers/specs/2026-07-13-issue-container-and-pr-pipeline.md",
  },
  {
    id: "tenancy-is-a-security-boundary",
    title: "Tenancy is a security boundary",
    body: "Every query is scoped by installationId, connection state is derived from getAccountState rather than re-derived locally, and a security gate has exactly one implementation - two copies are two places to drift, and drift here is a tenant leak.",
    source: "docs/superpowers/specs/2026-07-17-account-state-contract.md",
  },
  {
    id: "self-telemetry-is-gated",
    title: "Self-telemetry is gated on a database fact",
    body: "Access is decided by isPlatformInstallation before any query runs, and an access denial is a distinct state from a backend outage. superlog.project_id is a self-dogfooding tag, not tenant isolation.",
    source: "docs/superpowers/specs/2026-07-22-telemetry-tenancy-contract.md",
  },
  {
    id: "bring-your-own-model",
    title: "Bring your own model",
    body: "Every tenant action rides the tenant's own key. Keys are encrypted at rest, never logged, never returned by an API, and never destroyed as a side effect - providers do not re-issue them.",
    source: "docs/superpowers/specs/2026-07-16-byo-ai-models-design.md",
  },
  {
    id: "migrate-never-push",
    title: "prisma migrate deploy, never db push",
    body: "All worktrees share one Postgres. db push syncs it down to your schema and silently drops other people's columns; it has done so three times.",
    source: "docs/handoff/2026-07-22-orchestration-briefs.md §0",
  },
  {
    id: "separate-moving-from-fixing",
    title: "Separate moving from fixing",
    body: "Characterization tests come first on any untested surface. A refactor commit changes no behaviour and a fix commit moves no code; mixing them makes both unreviewable.",
    source: "docs/superpowers/plans/2026-07-23-reachability-and-consolidation-roadmap.md §1",
  },
  {
    id: "verify-by-driving",
    title: "Verify by driving the real flow",
    body: "A green suite is not a driven flow. Paste evidence. If you cannot verify something, say so - and never issue an unscoped DELETE against tenant data.",
    source: "docs/superpowers/plans/2026-07-23-reachability-and-consolidation-roadmap.md §1",
  },
];

// -------------------------------------------------------------------- convert

function toProvenance(item) {
  // `source` is a doc path, sometimes with a trailing section reference.
  const raw = item.source.trim();
  const docMatch = raw.match(/^([\w./-]+\.md)(.*)$/);
  if (docMatch) {
    const note = docMatch[2].trim().replace(/^[(\s]+|[)\s]+$/g, "");
    return note ? { doc: docMatch[1], note } : { doc: docMatch[1] };
  }
  return { note: raw, session: item.addedBy };
}

function convert(manifest) {
  // Rank is sparse (10, 20, 30…) within each importance band, so inserting an
  // item between two others never renumbers the list.
  const rankCursor = Object.fromEntries(IMPORTANCE.map((i) => [i, 0]));

  const items = manifest.items.map((item) => {
    const importance = IMPORTANCE_BY_PRIORITY[item.priority];
    rankCursor[importance] += 10;

    const programmes = [
      ...(REACHABILITY_PHASE[item.stage]
        ? [{ programme: "reachability", phase: REACHABILITY_PHASE[item.stage] }]
        : []),
      ...(EXTRA_PROGRAMMES[item.id] ?? []),
    ];

    const blockedBy = [...(item.blockedBy ?? []), ...(EXTERNAL_BLOCKERS[item.id] ?? [])];

    return {
      id: item.id,
      title: item.name,
      lane: INVENTORY_IDS.has(item.id) ? "inventory" : "idea",
      area: item.area,
      level: item.level,
      state: toState(item),
      importance,
      rank: rankCursor[importance],
      ...(programmes.length ? { programmes } : {}),
      ...(blockedBy.length ? { blockedBy } : {}),
      ...(item.href ? { href: item.href } : {}),
      ...(item.works ? { works: item.works } : {}),
      ...(item.gap ? { gap: item.gap } : {}),
      ...(item.evidence ? { evidence: item.evidence } : {}),
      provenance: toProvenance(item),
      origin: ORIGIN_BY_ADDED_BY[item.addedBy] ?? "session",
      addedAt: SEEDED_AT,
      addedBy: "seed",
      // `verifiedAt` is deliberately ABSENT on every row. This seed transcribes
      // the audits named in `provenance`; it did not independently re-confirm
      // each claim against the code. Absence must never read as verification.
    };
  });

  return {
    meta: {
      seededFrom: [
        "docs/roadmap/master-build-status.json",
        "docs/status/2026-07-22-build-status-map.md",
        "docs/superpowers/plans/2026-07-23-reachability-and-consolidation-roadmap.md",
        "docs/roadmap/backlog.md",
        "docs/status/2026-07-22-ridley-closeout.md",
        "docs/status/2026-07-20-phase-wrap-up.md",
        "docs/handoff/2026-07-22-orchestration-briefs.md",
      ],
      seededAt: SEEDED_AT,
      lastEditedAt: null,
      lastEditedBy: null,
    },
    mission: {
      northStar: "Kuma — your AI Software Healing Engineer.",
      statement:
        "Six specialist agents review every pull request, verify each finding against the real diff, and propose fixes a human approves. The long-term shape is a system that notices, diagnoses and heals software the way a living organism does. The review wedge is live; the platform ambitions are deliberately deferred, and recorded here with a reason so deferral stays a decision rather than a drift.",
      source: "docs/handoff/2026-07-22-orchestration-briefs.md §0",
    },
    principles: PRINCIPLES,
    programmes: PROGRAMMES,
    items,
  };
}

// ------------------------------------------------------------------- validate

/** The contract's documented rules, checked here so a bad seed never lands. */
function validate(doc) {
  const errors = [];
  const ids = new Set();
  const programmeIds = new Map(
    doc.programmes.map((p) => [p.id, new Set(p.phases.map((f) => f.key))])
  );

  for (const p of doc.programmes) {
    if (!STANDINGS.includes(p.standing)) errors.push(`programme ${p.id}: bad standing ${p.standing}`);
    if (!p.caveat?.trim()) errors.push(`programme ${p.id}: caveat is required`);
    if (!p.source?.trim()) errors.push(`programme ${p.id}: source is required`);
    for (const f of p.phases) {
      if (!PHASE_STATES.includes(f.state)) errors.push(`phase ${p.id}/${f.key}: bad state ${f.state}`);
    }
  }
  for (const pr of doc.principles) {
    if (!pr.source?.trim()) errors.push(`principle ${pr.id}: source is required`);
  }

  for (const it of doc.items) {
    if (ids.has(it.id)) errors.push(`duplicate id: ${it.id}`);
    ids.add(it.id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(it.id)) errors.push(`${it.id}: id must be kebab-case`);
    if (!AREAS.includes(it.area)) errors.push(`${it.id}: bad area`);
    if (!LEVELS.includes(it.level)) errors.push(`${it.id}: bad level`);
    if (!LANES.includes(it.lane)) errors.push(`${it.id}: bad lane`);
    if (!STATES.includes(it.state)) errors.push(`${it.id}: bad state ${it.state}`);
    if (!IMPORTANCE.includes(it.importance)) errors.push(`${it.id}: bad importance`);
    if (!ORIGINS.includes(it.origin)) errors.push(`${it.id}: bad origin`);
    if (!AUTHORS.includes(it.addedBy)) errors.push(`${it.id}: bad addedBy`);
    if (!Number.isInteger(it.rank)) errors.push(`${it.id}: rank must be an integer`);
    // The anti-fabrication rule, made structural.
    if (it.origin !== "user" && !it.provenance)
      errors.push(`${it.id}: provenance required when origin is not "user"`);
    for (const ref of it.programmes ?? []) {
      const phases = programmeIds.get(ref.programme);
      if (!phases) errors.push(`${it.id}: unknown programme ${ref.programme}`);
      else if (!phases.has(ref.phase)) errors.push(`${it.id}: unknown phase ${ref.programme}/${ref.phase}`);
    }
  }
  // Resolved last, so every dangling blocker is reported at once.
  for (const it of doc.items) {
    for (const b of it.blockedBy ?? []) {
      if (b.startsWith("ext:")) {
        if (!b.slice(4).trim()) errors.push(`${it.id}: empty ext: blocker`);
      } else if (!ids.has(b)) {
        errors.push(`${it.id}: blockedBy "${b}" resolves to nothing`);
      }
    }
  }
  return errors;
}

// ----------------------------------------------------------------------- main

const manifest = JSON.parse(await readFile(SOURCE, "utf8"));
const doc = convert(manifest);
const errors = validate(doc);

if (errors.length) {
  console.error(`REFUSING TO WRITE — ${errors.length} contract violation(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

await mkdir(dirname(TARGET), { recursive: true });
await writeFile(TARGET, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

const byLane = doc.items.reduce((a, i) => ({ ...a, [i.lane]: (a[i.lane] ?? 0) + 1 }), {});
const byState = doc.items.reduce((a, i) => ({ ...a, [i.state]: (a[i.state] ?? 0) + 1 }), {});
console.log(`wrote packages/dashboard/data/build-tracker.json`);
console.log(`  ${doc.items.length} items — ${JSON.stringify(byLane)}`);
console.log(`  states — ${JSON.stringify(byState)}`);
console.log(`  ${doc.programmes.length} programmes, ${doc.principles.length} principles`);
console.log(`  0 contract violations`);
