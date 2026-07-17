# Work-Item Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Fleet note (this repo):** tasks are grouped by lane — Tasks 1–4 Eng1, Task 5 Eng3, Tasks 6–7 Eng2. Each lane executes its tasks in order on its own branch; PM integrates on `integration-preview`.

**Goal:** Kuma proactively scans connected repos for issues/opportunities, presents them as a tenant-scoped work-item inbox on Services, and turns a selected item into a staged PR through the existing orchestration (one PR per item, HITL unchanged).

**Architecture:** New `WorkItem`/`ScanRun` tables feed a Services inbox. A webhook scan-trigger calls a new agents `POST /scan` (same specialists/critic as `/review`, repo context via the code map). "Fix it" creates an `IssueContainer` from the item's evidence and the existing drive → verify → compose → stage pipeline takes over.

**Tech Stack:** Prisma/Postgres (`@arete/db`), Express webhook (TS), FastAPI agents (Python/LangGraph), Next.js 16 dashboard, vitest/pytest.

## Global Constraints (from the spec — every task)

- Tenancy: every query filters by `installationId` (or via a repo scoped to it).
- Anti-fabrication: findings need real `{path, line}` evidence or they are dropped; empty scan → `no_findings`, never invented items; confidence is REAL (agent+critic), never synthesized.
- HITL moat: nothing auto-sends; only a human sets `solution_approved`; one PR per work item on branch `kuma/<kind>-<shortId>`.
- Secrets: model keys stay encrypted at rest, decrypted in-memory only, never logged/returned.
- Scan runs on the tenant's connected model (the `llm` block); no model → no scan.
- Account-State Contract: scanned-clean is `connected_idle` ("No issues found — rescan anytime"), never blank.
- Dedup: re-scan upserts on `(installationId, dimension, evidence-path fingerprint)`; `dismissed` stays dismissed.
- WorkItem states: `open → fixing → staged → posted`, or `open → dismissed`. No other transitions.

---

## Task 1 (Eng1): WorkItem + ScanRun schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append after `IssueContainer`)
- Create: `packages/db/prisma/migrations/20260717120000_add_work_item_scan_run/migration.sql`

**Interfaces — Produces:** Prisma models `workItem`, `scanRun` used by Tasks 2–4, 6–7.

- [ ] **Step 1: Add models to schema.prisma**

```prisma
/// One unit of discovered work — the "email" in the Services inbox.
/// kind: "issue" | "opportunity" | "error" | "pr_finding" (later: "campaign")
/// source: "scan" | "review" | "telemetry" (later: "catalog")
/// state: "open" | "fixing" | "staged" | "posted" | "dismissed"
model WorkItem {
  id             String   @id @default(uuid())
  installationId String
  kind           String
  source         String
  title          String
  detail         String
  /// [{ "path": "src/x.ts", "line": 12, "excerpt": "..." }] — REAL refs only.
  evidence       Json
  /// One of the six review dimensions (security, performance, quality,
  /// test_coverage, deployment_safety, business_logic).
  dimension      String
  confidence     Float
  state          String   @default("open")
  /// Dedup key: sha256 of installationId + dimension + sorted evidence paths.
  fingerprint    String
  containerId    String?
  scanRunId      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([installationId, fingerprint])
  @@index([installationId, state])
}

/// One scan execution — honest status, always recorded.
/// status: "running" | "complete" | "failed" | "no_findings"
model ScanRun {
  id             String    @id @default(uuid())
  installationId String
  repositoryId   String
  status         String    @default("running")
  error          String?
  startedAt      DateTime  @default(now())
  finishedAt     DateTime?

  @@index([installationId, startedAt])
}
```

- [ ] **Step 2: Write the migration SQL** (mirror the schema exactly — CREATE TABLE "WorkItem" / "ScanRun" with the unique index `WorkItem_installationId_fingerprint_key` and the two listed indexes; follow `20260716123000_add_issue_container/migration.sql` as the style reference).
- [ ] **Step 3:** `pnpm --filter @arete/db exec prisma migrate dev --name add_work_item_scan_run` against local PG → applies clean; `prisma generate` succeeds.
- [ ] **Step 4:** Commit `feat(db): WorkItem + ScanRun — the work-item inbox foundation`.

---

## Task 2 (Eng1): Scan trigger + executor (webhook)

**Files:**
- Create: `packages/webhook/src/scan/trigger.ts`, `packages/webhook/src/scan/trigger.test.ts`
- Modify: `packages/webhook/src/server.ts` (register `POST /scan/trigger`), the installation-created event handler (locate: `grep -rn "installation" packages/webhook/src --include='*.ts' -l`), and `packages/dashboard/src/app/api/model-connections/route.ts` (fire trigger after a successful connect)

**Interfaces:**
- Consumes: Task 1 models; `resolveModelConnectionForReview(externalId)` (existing, returns decrypted `llm` block or undefined); agents `POST /scan` (Task 5 contract below).
- Produces: `maybeStartScan(installationId: string): Promise<{ started: boolean; reason?: "no_model" | "no_repo" | "already_running" }>` and internal route `POST /scan/trigger {installationId}` (202 started / 409 already_running / 200 `{started:false,reason}`).

- [ ] **Step 1: Failing tests** — `trigger.test.ts` with an injected fake db + fake agents fetch:

```ts
it("does not start without a model connection", async () => {
  const r = await maybeStartScan("inst-1", deps({ model: null, repos: 1 }));
  expect(r).toEqual({ started: false, reason: "no_model" });
});
it("409s a second scan while one runs", async () => {
  const d = deps({ model: llm(), repos: 1, runningScan: true });
  expect(await maybeStartScan("inst-1", d)).toEqual({ started: false, reason: "already_running" });
});
it("records failed ScanRun with the error when /scan errors", async () => { /* agents fetch rejects → scanRun.status "failed", error set */ });
it("upserts findings by fingerprint and never resurrects dismissed items", async () => {
  // seed a dismissed WorkItem with fingerprint F; /scan returns the same finding
  // → upsert skips it (state stays "dismissed"), no duplicate row
});
it("marks no_findings when the scan returns empty", async () => { /* status no_findings, zero items */ });
```

- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3: Implement `trigger.ts`** — flow: repo? model? running ScanRun? → create ScanRun(running) → `fetch(agentsUrl + "/scan", { body: { installationId, repoSlug, llm } })` → for each finding compute `fingerprint = sha256(installationId + dimension + sortedEvidencePaths)` → `workItem.upsert` on `installationId_fingerprint` (update title/detail/confidence/scanRunId ONLY when existing state is "open"; create as "open"; skip when dismissed/fixing/staged/posted) → ScanRun `complete` / `no_findings` / `failed`+error. Never throw to the caller; return the result object.
- [ ] **Step 4:** Tests pass. **Step 5:** Wire the three call sites (installation handler fire-and-forget; model-connections POST fire-and-forget `fetch(WEBHOOK_SERVICE_URL + "/scan/trigger")` after upsert; server.ts route). **Step 6:** Commit `feat(webhook): auto-scan trigger — repo+model gated, honest ScanRun status`.

---

## Task 3 (Eng1): Review findings → WorkItems

**Files:**
- Create: `packages/webhook/src/scan/review-sync.ts`, `packages/webhook/src/scan/review-sync.test.ts`
- Modify: the review-completion path (where `ReviewComment` rows are written after `runReviewPipeline` — locate: `grep -rn "reviewComment" packages/webhook/src --include='*.ts' -l`)

**Interfaces:** Produces `syncReviewFindings(installationId: string, reviewId: string, comments: {path:string; line:number; body:string; category:string; severity:string}[]): Promise<number>` — inserts `kind:"pr_finding", source:"review"` WorkItems (severity error/warning only), same fingerprint dedup, `confidence` from the review's stored confidence when present else 0.5 with detail noting "unscored".

- [ ] Steps: failing test (2 error/warning comments → 2 items; re-run → 0 new; info-severity skipped) → implement → pass → wire into the review-completion path after comments persist → commit `feat(webhook): PR-review findings land in the work-item inbox`.

---

## Task 4 (Eng1): Manual scan API (dashboard)

**Files:**
- Create: `packages/dashboard/src/app/api/scan/route.ts`, `packages/dashboard/src/lib/scan-api.test.ts`

**Interfaces:** Consumes `requireScope()` (`@/lib/model-connections-api`, returns `{installationIds} | null`). Produces `POST /api/scan` → 401 unauthenticated · 403 no installation · proxies to webhook `POST /scan/trigger` → 202 started / 409 already_running / 200 `{started:false, reason:"no_model"}` passthrough.

- [ ] Steps: failing tests (401 / 403 / 202-proxy / 409-passthrough with mocked fetch) → implement (follow the `model-connections/route.ts` pattern: `requireScope`, target `scope.installationIds[0]`, never trust a body installationId) → pass → commit `feat(dashboard): POST /api/scan — manual re-scan, session-scoped`.

---

## Task 5 (Eng3): Agents POST /scan

**Files:**
- Create: `packages/agents/src/arete_agents/scan.py`, `packages/agents/tests/test_scan.py`
- Modify: `packages/agents/src/arete_agents/server.py` (add route), `packages/agents/src/arete_agents/models/pr.py` (request/response models)

**Interfaces:**
- Consumes: `get_llms_by_role_from_config` / `_resolve_settings()` (existing lazy pattern in server.py — scan must NOT break keyless boot); `build_graph_export(installation_id)` (code map); `ensure_repo_checked_out` (repo cache) for targeted file reads.
- Produces (the Task 2 wire contract):

```python
class ScanRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    installation_id: int = Field(alias="installationId")
    repo_slug: str = Field(alias="repoSlug")
    llm: LLMConfig | None = None   # same block as /review

class ScanFinding(BaseModel):
    kind: Literal["issue", "opportunity"]
    title: str
    detail: str
    evidence: list[dict]           # [{"path": str, "line": int, "excerpt": str|None}]
    dimension: str                 # one of the six
    confidence: float              # ge=0, le=1 — from agent+critic

class ScanResponse(BaseModel):
    status: Literal["complete", "no_findings"]
    findings: list[ScanFinding]
```

- [ ] **Step 1: Failing tests** — `test_scan.py`: (a) evidence-free finding from a stubbed specialist is DROPPED; (b) evidence path not present in the repo checkout is DROPPED (grounding check); (c) empty result → `status:"no_findings", findings:[]`; (d) `llm` block builds clients via `get_llms_by_role_from_config` (patch and assert, mirroring `test_review_byo.py`'s lazy-accessor patching); (e) ollama-unavailable → 503 with the pull hint (reuse `ollama_unavailable_reason`).
- [ ] **Step 2:** FAIL. **Step 3: Implement** — `run_scan(req)`: graph export → select up to 20 highest-degree files → read them from the checkout → brief each of the six specialists ("find concrete issues AND improvement opportunities; every finding must cite file:line from the provided sources; return kind issue|opportunity") → critic pass validates each finding's evidence against the actual file content (path exists AND line in range, else drop) → ScanResponse. Endpoint `@app.post("/scan")` mirrors `/review`'s BYO/lazy/Ollama-503 structure exactly.
- [ ] **Step 4:** `pytest packages/agents -q` green. **Step 5:** Commit `feat(agents): POST /scan — repo-wide specialist scan, critic-grounded findings`.

---

## Task 6 (Eng2): Inbox queries + Services UI

**Files:**
- Create: `packages/dashboard/src/lib/work-items.ts`, `packages/dashboard/src/lib/work-items.test.ts`
- Modify: `packages/dashboard/src/app/(dashboard)/services/page.tsx`, `packages/dashboard/src/components/dashboard/services/services-workspace.tsx`, `packages/dashboard/src/components/dashboard/services/services-workspace.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface WorkItemView { id: string; kind: "issue"|"opportunity"|"error"|"pr_finding";
  title: string; detail: string; evidence: {path:string; line:number; excerpt?:string}[];
  dimension: string; confidence: number; state: "open"|"fixing"|"staged"|"posted"|"dismissed"; }
export interface InboxView { items: WorkItemView[]; lastScan: { status: string; finishedAt: string|null } | null; }
export async function getWorkItemInbox(db: PrismaClient, installationIds: string[]): Promise<InboxView>;
```

- [ ] **Step 1:** Failing query tests (fake db): tenant scoping; dismissed excluded from the default list; lastScan is the newest ScanRun. **Step 2:** implement, pass.
- [ ] **Step 3:** UI failing tests, then render: under each connected repo row — `Issues (N) / Opportunities (M)` badge counts (open items only); item rows (kind chip · title · dimension · confidence); selecting an item shows detail+evidence in the Kuma pane; scan status line ("Scanning…" / "Scanned <time> — no issues found" / "Scan failed: <err> — retry") + **Scan** button → `POST /api/scan`; three-state rule holds (scanned-clean shows the honest populated line, never blank). Assertions include: `Issues (`, `Opportunities (`, `Scan`, and NOT `No reviews yet.` when items exist.
- [ ] **Step 4:** Full dashboard suite green. **Step 5:** Commit `feat(services): the work-item inbox — mailbox counts, evidence view, scan status`.

---

## Task 7 (Eng2): Triage — Fix / Dismiss → pipeline

**Files:**
- Create: `packages/dashboard/src/app/api/work-items/[id]/fix/route.ts`, `packages/dashboard/src/app/api/work-items/[id]/dismiss/route.ts`, `packages/dashboard/src/lib/work-item-triage.test.ts`
- Modify: services item row (Fix it / Implement it / Dismiss buttons)

**Interfaces:**
- Consumes: Task 6 views; `db.issueContainer` (columns: `state, gates, target, pr, patch, findings` — see schema); the existing drive/SSE path (`/api/containers/[id]/stream`).
- Produces: `POST /api/work-items/[id]/fix` → 401 / 404 (cross-tenant reads as not-found) / 409 (state ≠ open) / 200 `{containerId}`; `POST /api/work-items/[id]/dismiss` → 200 (state dismissed, only from open).

- [ ] **Step 1:** Failing tests: cross-tenant fix → 404; fix from `dismissed` → 409; happy path creates a container with `target` from the repo, `findings` = the item's evidence payload, `gates: {solutionApprovedAt: null}`, `pr.title` = item title and branch `kuma/<kind>-<id8>` recorded in `pr` — and sets `workItem.state="fixing"` + `containerId`; dismiss happy path.
- [ ] **Step 2:** Implement both routes (requireScope; `where: { id, installationId: { in: scope.installationIds } }` on every read/write). The container is then driven/streamed by the existing Fix workflow; approving + Send PR flip the item `staged → posted` at the same choke points the container transitions (add the two `workItem.update` calls where container state changes — locate: the approve route and the staging send path).
- [ ] **Step 3:** Suite green; state-matrix test: a fixing item renders its live-stream link; a posted item shows the PR link. **Step 4:** Commit `feat(services): triage — Fix it/Implement it/Dismiss; one staged PR per item, HITL unchanged`.

---

## Self-review (done inline)
- Spec §1→Task 1, §2→Tasks 2/3/4/5, §3→Task 6, §4→Task 7, §5 lanes→task grouping, §6 invariants→Global Constraints, §7 tests distributed per task, §8 future→excluded (YAGNI). No TBDs. Wire contract (`ScanRequest/ScanResponse` ↔ Task 2 fetch body, `WorkItemView` states ↔ schema enum, `maybeStartScan` reasons ↔ Task 4 passthrough) checked for name/type consistency.
