# Phase 2 Implementation Plan — Alerting + Healing-Run Safety

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md` §3 Phase 2, §6 Phase 2 gates
**Branch:** `stroland02/obs-phase-2` (off `integration-preview@b491e60`, Phase 1 merged)
**Retrospective governing this phase:** `docs/roadmap/2026-07-21-phase-1-retrospective.md`

**Goal:** Alerts on the metrics Phase 1 started emitting create incidents that flow into the
existing fix pipeline, and that pipeline stops being able to run unbounded.

**Architecture:** Prometheus evaluates alerting rules over the Phase-1 metrics and hands firing
alerts to Alertmanager, which posts them to a token-guarded receiver on the webhook service. The
receiver records an `Incident` and opens a `WorkItem`, which enters the *existing* fix path — one
model, not a second system. In parallel the fix path moves off the HTTP request process onto
BullMQ, gaining the concurrency cap and cooldown it has never had.

**Tech stack:** Prometheus alerting rules + `promtool test rules`; Alertmanager (grouping/dedup —
not reimplemented in app code); BullMQ (existing patterns in `packages/webhook/src/queue.ts`);
Prisma; Pydantic (`packages/agents/src/arete_agents/models/fix.py`).

---

## Scope decisions (recorded 2026-07-21)

Made after a source survey found four places where spec §3 assumes behavior the code does not have.
**These decisions govern; where this plan and spec §3 disagree, this plan wins and the spec gets
amended in Task 10.**

| Spec §3 says | Reality | Decision |
|---|---|---|
| "Tool descriptions carry the rubrics — in a tool-calling agent, tool descriptions ARE the prompt" | The fix agent has **no tool loop**. `fix_pipeline.py:87-119` invokes the LLM directly for a JSON blob. Tool-calling exists only on the review side (`agents/base.py:188`). | Rubrics go in the **fix prompt**, not tool descriptions. Giving the fix pipeline a tool loop is deferred to Phase 2b. |
| Confidence 0–10 with calibrated criteria | 0–1 floats in five consumers: `StatusReport` (`orchestration/src/status-report.ts:28-38`), `AgentStatus` (`models/review.py:58`), `FixItem` (`models/fix.py:49`), `WorkItem.confidence` (Prisma), and `escalationTier()` (`orchestration/src/escalation.ts:9-14`); UI renders `confidence * 100`. | **Keep 0–1.** Adopt the *criteria* (the part that matters) anchored on the existing scale. No conversion boundary, no consumers touched. |
| Dispatch-before-ack must be built | Already correct: approve/send/apply perform the effect then ack (`containers/[id]/send/route.ts:87-97`); `propose_pr`'s description already tells the model it only validates. | Reduces to an **audit + regression tests** that pin the behavior (Task 9). No rewrite. |
| Budgets: runtime cap, wall-clock backstop, cooldowns | A 280s wall-clock cap already exists (`fix_pipeline.py:53`). The real hole is different: `POST /fix/trigger` runs `void driveFix(...)` **in-process on the webhook HTTP server** (`server.ts:275-288`) — no queue, no concurrency cap, and no cooldown after a run fails back to `open`. | Build the **missing** guard (Tasks 5–6), not the one that exists. |

**Deferred to Phase 2b** (filed in `docs/roadmap/backlog.md` at Task 10): telemetry-fed
investigations (needs an internal query surface — only `getAgentEventsPerMinute` reaches ClickHouse
today, `queries.ts:781-815`), and the fix-pipeline tool loop.

## Precedence (user ruling, 2026-07-21)

> "this workflow and development takes precedence over conflicting data pipelines and workflows as
> this is from the source and should take priority. this includes UI design as well."

**Operative meaning.** Where this plan's conventions collide with an existing pattern elsewhere in
the repo — telemetry/data pipelines, queue and workflow shapes, dashboard and UI treatment of
incidents, findings, and confidence — **this line of work wins.** An implementer who finds a
conflict adopts the convention here and notes the divergence in their report; they do not stop and
ask, and they do not bend this work to match the older pattern.

Concretely: the `arete.*` metric namespace, the §5 span tree, the redaction pattern set, the
`Incident` shape, and the queue/cooldown semantics defined here are the reference the rest of the
codebase converges toward. Where a dashboard surface must render incidents, alerts, findings, or
confidence, this work's model governs the presentation.

**Two things this ruling does not authorize**, because they are cost-asymmetric — a wrong call is
cheap to avoid and expensive to undo:

- **Deleting or disabling working behavior** that other features depend on, as opposed to overriding
  a convention. Overriding a naming or display pattern: proceed. Removing a pipeline something else
  consumes: report it and let the orchestrator decide.
- **Relaxing a security, tenancy, or HITL constraint** (Global Constraints 1–5 below). Precedence
  resolves style and architecture conflicts, not safety ones. If this work appears to require
  loosening one, that is a finding to surface, not a licence.

## Global Constraints

Copied verbatim from the spec and the retrospective. Every task's requirements include these.

1. **Cardinality (spec §5, hard):** metric dimensions must be closed, low-cardinality sets. Repo
   names, PR numbers, installation ids, SHAs, tenant ids → **span attributes only, never metric
   dimensions**. Violations are review-blocking.
2. **Redaction (spec §5):** the canonical pattern set lives in `packages/telemetry/src/redaction.ts`
   and is mirrored in `arete_agents/observability.py` and `infra/otel-collector-config.yaml`. A new
   sink must not introduce an unscrubbed path. Alert payloads and incident rows are sinks.
3. **Telemetry never takes the app down (spec §3):** every init wrapped; failure logs one warning
   and the service runs on.
4. **Tenancy (roadmap §8.4):** every read/write scoped by `Installation`. Cross-tenant tests are
   part of DoD.
5. **HITL preserved (roadmap §8.5):** an incident may *open* a fix run. It must never merge, apply,
   or post without the existing human gates.
6. **New instrumentation:** every new code path arrives with spans/metrics/logs per the
   `instrument-every-feature` skill. Metric names follow the `arete.*` namespace.
7. **Retrospective action 1 — reviewers verify against the installed package**, not the docs, the
   plan, or the diff. Five of Phase 1's seven defects were caught only this way.
8. **Retrospective action 3 — challenge the plan.** If this plan's described behavior contradicts
   the installed library or the actual source, **stop and report**. Do not transcribe. Five of
   Phase 1's seven defects came from implementers faithfully copying a wrong plan.
9. **Commits are pathspec-limited** (`git commit -- path`). Concurrent agents swept each other's
   staged files into the wrong commits twice in Phase 1.
10. **Every security gate needs a mutation test.** A gate never observed failing is not known to
    work.

---

## File structure

**Create:**
- `infra/prometheus-rules/arete-alerts.yml` — alerting rules
- `infra/prometheus-rules/arete-alerts.test.yml` — `promtool` rule tests
- `infra/alertmanager.yml` — routing to the receiver
- `packages/webhook/src/alerting/receiver.ts` — Alertmanager webhook receiver + fingerprint idempotency
- `packages/webhook/src/alerting/incident.ts` — incident → WorkItem routing
- `packages/webhook/src/alerting/*.test.ts`
- `packages/webhook/src/fix/queue-consumer.ts` — the BullMQ consumer for fix drives
- `packages/webhook/src/fix/cooldown.ts` — re-entry guard
- `packages/agents/src/arete_agents/fix_findings.py` — findings model + rubric
- `packages/db/prisma/migrations/<ts>_add_incident/migration.sql`

**Modify:**
- `packages/db/prisma/schema.prisma` — `Incident` model
- `packages/webhook/src/queue.ts` — `FIX_QUEUE_NAME`, concurrency, enqueue helper
- `packages/webhook/src/server.ts:275-288` — `/fix/trigger` enqueues instead of `void driveFix`
- `packages/webhook/src/worker.ts` — register the fix consumer
- `packages/webhook/src/fix/trigger.ts` — cooldown check; `driveFix` becomes the job handler
- `packages/agents/src/arete_agents/fix_pipeline.py` — findings-first gate
- `packages/agents/src/arete_agents/tools/memory.py` — real persistence
- `infra/docker-compose.yml`, `infra/prometheus.yml` — alertmanager + `rule_files`

---

## Task sequencing

Tasks 1–4 (alerting) and 5–6 (fix safety) are independent and may run in parallel **in separate
worktrees**. Task 7 depends on both. Tasks 8–10 are close-out.

| Task | Title | Review | Model |
|---|---|---|---|
| 1 | Prometheus alerting rules + rule tests | spot-check | cheap |
| 2 | `Incident` model + migration | spot-check | cheap |
| 3 | Alertmanager + token-guarded receiver | **independent reviewer** (§6 gate: internal tokens as write credentials) | standard |
| 4 | Incident → WorkItem routing | spot-check | standard |
| 5 | Fix runs onto BullMQ | spot-check | standard |
| 6 | Concurrency cap + cooldown + idempotent terminate | spot-check | standard |
| 7 | Findings-first gate + calibrated rubric | spot-check | standard |
| 8 | Memory write-back (close the stub) | **independent reviewer** (§6 gate: repo-access scoping, tenant guard) | standard |
| 9 | Dispatch-before-ack audit + regression tests | spot-check | cheap |
| 10 | Security gate sweep, spec amendment, DoD evidence | **independent reviewer** | most capable |

Per the recorded rigor decision: independent reviewers on security-critical chunks only. Everything
else gets implementer + orchestrator spot-check. All chunks still require red-then-green evidence.

---

### Task 1: Prometheus alerting rules

**Files:** Create `infra/prometheus-rules/arete-alerts.yml`, `infra/prometheus-rules/arete-alerts.test.yml`. Modify `infra/prometheus.yml`, `infra/docker-compose.yml`.

**Why both rules:** spec §3 — "error-rate alerts AND the p95 latency rule (error-driven pipelines
are constitutionally blind to graceful-but-slow degradation)." A pipeline that returns correct
results 4× slower fires no error alert and is invisible without the latency rule.

**Metrics available** — verify against `packages/webhook/src/observability.ts:34-41` and
`packages/telemetry/src/init.ts:58-65` before writing. The collector's `prometheus` exporter applies
`namespace: arete` and rewrites dots to underscores, so **confirm the actual exposed series names at
`http://localhost:8889/metrics` rather than assuming the translation**:
- `arete.review.runs` counter, dims `outcome`, `trigger`
- `arete.review.duration` histogram, boundaries `[1,2,5,10,30,60,120,180,300]`
- `arete.queue.jobs` counter, dims `queue`, `outcome`

**Rules to write:**
- `AreteReviewErrorRate` — ratio of `outcome="failure"` review runs to all review runs over 15m
  exceeds 10%, `for: 10m`. The window must exceed the histogram's own 300s tail so a single slow
  review cannot trip it.
- `AreteReviewLatencyP95` — `histogram_quantile(0.95, ...)` over the review-duration buckets exceeds
  180s for 15m.
- `AreteQueueFailureRate` — `arete.queue.jobs` with `outcome="failed"` over 15m.

Each carries `labels: {severity}` and `annotations: {summary, description, runbook_url}`. Keep label
sets closed per Global Constraint 1 — no repo or installation labels.

- [ ] **Step 1: Write the rule tests first** (`arete-alerts.test.yml`) using `promtool`'s
      `input_series` / `alert_rule_test` format: one series that should fire, one that should not,
      and one **boundary** series just under the threshold that must stay silent. The boundary case
      is the mutation test for this gate (Global Constraint 10).
- [ ] **Step 2: Run and watch it fail:** `docker run --rm -v "$PWD/infra/prometheus-rules:/rules" prom/prometheus:latest promtool test rules /rules/arete-alerts.test.yml` — expect failure (no rules file yet).
- [ ] **Step 3: Write `arete-alerts.yml`.**
- [ ] **Step 4: Re-run promtool — expect PASS.** Paste real output in the report.
- [ ] **Step 5:** Add `rule_files: ["/etc/prometheus/rules/*.yml"]` to `infra/prometheus.yml` and mount the directory in `infra/docker-compose.yml`.
- [ ] **Step 6: Verify live.** Bring the stack up, open `http://localhost:9090/rules`, confirm all three rules load with no parse errors. Capture the output.
- [ ] **Step 7:** `git commit -- infra/prometheus-rules infra/prometheus.yml infra/docker-compose.yml`

**Operational note:** Prometheus does **not** hot-reload rule files on edit without a SIGHUP or
`--web.enable-lifecycle` reload. The Phase 1 collector taught this lesson expensively — a config
change that appears not to work is usually a container that never reloaded it.

---

### Task 2: `Incident` model + migration

**Files:** Modify `packages/db/prisma/schema.prisma`. Create the migration.

**Interfaces produced** (Tasks 3 and 4 consume these exact names):

```prisma
/// An alert-born incident. Created by the Alertmanager receiver, resolved when
/// the alert clears. One row per (installationId, fingerprint) — Alertmanager
/// re-sends the same firing alert on its repeat interval, and every resend must
/// land on the same row rather than opening a new incident.
model Incident {
  id             String       @id @default(uuid())
  installationId String
  /// Alertmanager's own fingerprint for the alert instance. The idempotency key.
  fingerprint    String
  alertName      String
  severity       String       /// "critical" | "warning"
  /// "firing" | "resolved"
  status         String       @default("firing")
  summary        String
  /// Alert labels + annotations as received. Scrubbed before write (Task 3).
  payload        Json
  startsAt       DateTime
  resolvedAt     DateTime?
  /// Set when this incident opened a fix run. Null if it never did.
  workItemId     String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  installation   Installation @relation(fields: [installationId], references: [id])

  @@unique([installationId, fingerprint])
  @@index([installationId, status])
}
```

Add `incidents Incident[]` to the `Installation` model.

- [ ] **Step 1:** Add the model and back-relation to `schema.prisma`.
- [ ] **Step 2:** Generate the migration with Prisma. Check the package name in `packages/db/package.json` first, then run the repo's established migrate command (see how prior migrations under `packages/db/prisma/migrations/` were produced).
- [ ] **Step 3:** Confirm the generated SQL contains the unique constraint on `(installationId, fingerprint)` — it is what makes the receiver idempotent. Paste the SQL in the report.
- [ ] **Step 4:** Regenerate the Prisma client, then typecheck the packages that consume it.
- [ ] **Step 5:** `git commit -- packages/db/prisma`

---

### Task 3: Alertmanager + token-guarded receiver — **SECURITY-CRITICAL, independent review**

**Files:** Create `infra/alertmanager.yml`, `packages/webhook/src/alerting/receiver.ts`, `packages/webhook/src/alerting/receiver.test.ts`. Modify `infra/docker-compose.yml`, `infra/prometheus.yml`, `packages/webhook/src/server.ts`.

**Consumes:** the `Incident` model from Task 2.
**Produces:** `handleIncomingAlert(body): Promise<{ created: number; updated: number }>` — Task 4 extends this path.

**Why Alertmanager rather than in-app evaluation:** grouping, dedup, inhibition, and repeat
intervals are exactly the logic that looks trivial and is not. Alertmanager also gives resolution
notifications for free, which is what closes an incident.

**Requirements:**
- Route: `POST /alerts/incoming`, guarded by the **existing** internal-token middleware — the same
  one `/fix/trigger` uses (`server.ts:275`). Find its definition and reuse it; do not write a second
  auth path.
- Idempotent by `(installationId, fingerprint)` via `upsert`. Alertmanager resends firing alerts on
  its repeat interval; a second delivery must update, never duplicate.
- `status: "resolved"` in the payload sets `status` and `resolvedAt` on the existing row.
- **Scrub the payload before writing.** Alert annotations can carry query fragments and URLs. Use
  `scrubLogValue` from `@arete/telemetry` (`packages/telemetry/src/redaction.ts`) — do not write a
  new scrubber.
- Instrument per the `instrument-every-feature` skill: a span, and an `arete.incidents` counter with
  closed dims (`alertName`, `severity`, `status`) only.
- Never throw out of the handler in a way that 500s Alertmanager into an infinite retry: log and
  return 2xx for malformed payloads; non-2xx only for auth failure.

**Tests (red first, all of them):**
- [ ] **Step 1: Write the failing tests.**
  1. A request with **no** internal token is rejected 401 and writes no row. *(Mutation test for the gate — Global Constraint 10.)*
  2. A request with a **wrong** token is rejected 401.
  3. A valid firing alert creates exactly one `Incident`.
  4. **The same alert delivered twice creates exactly one row** and bumps `updatedAt`.
  5. A `resolved` payload sets `status` and `resolvedAt` on the existing row.
  6. An alert whose annotation contains a secret-shaped string (`ghp_` + 16 chars) is stored scrubbed — assert the raw secret appears nowhere in the persisted row.
  7. An alert for installation A never produces a row readable under installation B.
- [ ] **Step 2: Run them — expect failure.** Capture output.
- [ ] **Step 3: Implement** `receiver.ts` and wire the route in `server.ts`.
- [ ] **Step 4: Write `infra/alertmanager.yml`** — a single `webhook_config` pointing at the webhook service, carrying the internal token as an `http_config` credential, `group_by` on `alertname`, and a repeat interval long enough that the idempotency path is genuinely exercised in real operation.
- [ ] **Step 5: Add the alertmanager service** to `infra/docker-compose.yml` and point Prometheus at it (`alerting.alertmanagers`).
- [ ] **Step 6: Run the tests — expect PASS.** Capture output.
- [ ] **Step 7: Live end-to-end proof.** Bring the stack up, fire a synthetic alert (POST a fabricated alert to Alertmanager's `/api/v2/alerts`, or temporarily lower a rule threshold), and show the `Incident` row appearing in Postgres. A passing unit test is not evidence the wire works.
- [ ] **Step 8:** `git commit -- packages/webhook/src/alerting packages/webhook/src/server.ts infra/alertmanager.yml infra/docker-compose.yml infra/prometheus.yml`

**Reviewer focus:** verify the internal-token middleware actually rejects (read its source; do not
infer from its name); verify the token is not logged anywhere on the request path; verify the upsert
cannot be induced to cross tenants by a spoofed label; verify the scrub reaches the nested
`annotations` object, not only top-level strings.

---

### Task 4: Incident → WorkItem routing

**Files:** Create `packages/webhook/src/alerting/incident.ts` + test. Modify `receiver.ts`.

**Consumes:** `Incident` (Task 2), the receiver path (Task 3), and the cooldown helper (Task 6). If
Task 6 has not landed when this runs, define the call site against its published signature and leave
it stubbed; Task 7's integration step wires it.

An incident of `severity: "critical"` opens a `WorkItem` (`kind: "error"`, plus the `dimension` and
`confidence` fields the existing model requires) and links it back via `Incident.workItemId`.
Warnings record the incident only. The WorkItem enters the existing fix path — **do not build a
second trigger route.**

**Global Constraint 5 applies hard here:** an alert may open a fix run. It must never cause a merge,
apply, or post. The existing HITL gates (`containers/[id]/approve`, `containers/[id]/send`) stay in
the path untouched.

- [ ] **Step 1: Write failing tests** — critical opens exactly one WorkItem and links it; a repeat delivery of the same fingerprint does **not** open a second; warning opens none; the created WorkItem carries the incident's `installationId` and nothing cross-tenant.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS. Capture output.
- [ ] **Step 5:** `git commit -- packages/webhook/src/alerting`

---

### Task 5: Fix runs onto BullMQ

**Files:** Modify `packages/webhook/src/queue.ts`, `packages/webhook/src/server.ts:275-288`, `packages/webhook/src/worker.ts`. Create `packages/webhook/src/fix/queue-consumer.ts` + test.

**The defect being fixed:** `/fix/trigger` currently runs `void driveFix(...)` on the webhook's HTTP
request process. Nothing bounds how many fix drives run at once, so a burst fans out into unbounded
LLM calls and repo checkouts on the very process that also answers GitHub webhooks. The review path
has had `REVIEW_QUEUE_CONCURRENCY = 5` since it was built (`queue.ts:19`); fix has never had an
equivalent.

**Follow the existing pattern exactly** — read `queue.ts` and `worker.ts` for how `review-pr` and
`approval-exec` are declared, connected, and consumed, **including the `BullMQOtel` telemetry
wiring** (Phase 1 added it; a new queue constructed without it silently breaks trace continuity
through Redis).

- `FIX_QUEUE_NAME = 'fix-drive'`, `FIX_QUEUE_CONCURRENCY = 2` (lower than review: a fix drive does a
  full repo checkout).
- `/fix/trigger` enqueues and still ACKs `202 {started:true}` — the dispatch-before-ack shape there
  is deliberate and documented (`server.ts:269-274`); preserve it.
- `driveFix` becomes the job handler. Its failure path (`fail()` → `state:'fix_failed'`, WorkItem
  back to `open`) must survive a job retry without double-writing.

- [ ] **Step 1: Write the failing test** — enqueueing a fix job invokes `driveFix` once with the right payload, and `/fix/trigger` returns 202 without having run the drive inline.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Implement queue, consumer, and route change.
- [ ] **Step 4:** Run the webhook suite — expect PASS. Capture output.
- [ ] **Step 5: Verify trace continuity.** Trigger a fix with the stack up and confirm in Jaeger that the enqueue span and the drive span share one trace. Use the `debug-from-telemetry` skill.
- [ ] **Step 6:** `git commit -- packages/webhook/src/queue.ts packages/webhook/src/fix packages/webhook/src/server.ts packages/webhook/src/worker.ts`

---

### Task 6: Concurrency cap, cooldown, idempotent terminate

**Files:** Modify `packages/webhook/src/fix/trigger.ts`. Create `packages/webhook/src/fix/cooldown.ts` + test.

**The hole:** the only re-entry guard today is `WorkItem.state !== 'open'` → 409
(`work-items/[id]/fix/route.ts:34-36`), which holds *only while a run is active*. The moment a run
fails back to `open`, an immediate re-trigger is allowed — a failing fix can be retried in a tight
loop, each attempt costing a checkout and LLM calls.

**Produces:** `checkFixCooldown(workItemId): Promise<{ allowed: boolean; retryAfterSeconds?: number }>`

- Cooldown after `fix_failed`: exponential on consecutive failures for the same WorkItem, from 5
  minutes, capped at 1 hour. Derive the failure count from existing state if possible; add a column
  only if you can show it cannot be derived. Report which you chose and why.
- Both entry points enforce it: the dashboard route returns **429 with a `Retry-After` header** (not
  409 — the distinction tells a client whether retrying is meaningful), and the queue consumer drops
  a job whose cooldown is active rather than running it.
- Idempotent terminate: a drive that is already terminal must not re-write state or re-emit metrics.

- [ ] **Step 1: Write failing tests** — a first failure followed by an immediate re-trigger is refused with 429 and a `Retry-After` header; after the window elapses it is allowed; the backoff grows across consecutive failures; a **successful** run clears the cooldown; calling terminate twice writes state once.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS. Capture output.
- [ ] **Step 5:** `git commit -- packages/webhook/src/fix`

---

### Task 7: Findings-first gate + calibrated rubric

**Files:** Create `packages/agents/src/arete_agents/fix_findings.py` + `packages/agents/tests/test_fix_findings.py`. Modify `packages/agents/src/arete_agents/fix_pipeline.py`.

**Spec §3:** "Findings-first gate: terminal actions require a prior structured findings report."
Today `_run_fix_inner` (`fix_pipeline.py:194-323`) goes checkout → read evidence → `author_patch`. A
patch is authored with no structured statement of *what is wrong and on what evidence*.

**The rubric, on the existing 0–1 scale** (scope decision above — do **not** introduce 0–10):

| Confidence | Criteria |
|---|---|
| 0.9–1.0 | Verbatim quote from a file read **this run**, AND an observed/reproduced failure (test output, CI log, stack trace) |
| 0.7–0.9 | Verbatim quote from a file read this run; failure inferred, not reproduced |
| 0.4–0.7 | Grounded in the checkout but paraphrased, or the causal link is argued rather than shown |
| ≤0.3 | Speculative — no quote, or the quote does not resolve in the checkout |

**Evidence format is mandatory:** `path:line` plus a fenced verbatim quote. This is mechanically
enforceable and must be enforced — reuse the deterministic grounding pattern already in
`_ground_files` (every path must resolve in the checkout) rather than trusting the model's
self-report.

**The gate:** `author_patch` is not called unless a findings report exists for the run with at least
one finding at confidence ≥ 0.4 whose evidence paths all resolve in the checkout. A run that cannot
produce one returns `fix_failed` with `reason="no_grounded_findings"` — an honest failure rather
than a speculative patch.

- [ ] **Step 1: Write failing tests** — a findings report whose evidence path does not exist in the checkout is rejected; a report containing only ≤0.3 findings does not reach `author_patch`; a valid report proceeds; a run with no report at all returns `fix_failed` with the documented reason; confidence outside [0,1] is a validation error.
- [ ] **Step 2:** `pytest packages/agents/tests/test_fix_findings.py -v` — expect failure.
- [ ] **Step 3:** Implement the Pydantic model, the rubric text in the fix prompt, and the gate in `_run_fix_inner`.
- [ ] **Step 4:** Run the agents suite — expect PASS. Capture output.
- [ ] **Step 5:** `git commit -- packages/agents/src/arete_agents packages/agents/tests`

---

### Task 8: Memory write-back — **SECURITY-CRITICAL, independent review**

**Files:** Modify `packages/agents/src/arete_agents/tools/memory.py`. Create the persistence endpoint on the webhook service + tests on both sides.

**Current state:** `tools/memory.py:1-18` is a pure stub — it logs and returns a hardcoded success
string; its own comment admits it. An agent calling `add_project_memory` is therefore **told the
write succeeded when nothing was written** — a dispatch-before-ack violation hiding in plain sight,
and the reason this task sits beside the Task 9 audit.

The `AgentMemory` Prisma model already exists (`schema.prisma:278-291`) with exactly the four kinds
spec §3 asks for (`feedback | terminology | infra | project`) and an index on
`[repositoryId, status]`. The real write path today is `packages/webhook/src/chat-handler.ts:115`.

**Requirements:**
- Persist through a token-guarded internal endpoint on the webhook service (reuse the existing
  internal-token middleware; do not open a DB pool from Python).
- **Size cap** per spec §3 ("size-capped"): cap `body` length and total active rows per repository;
  on breach, reject with a clear message rather than truncating silently.
- **Tenant guard:** the repository must belong to the calling installation. A memory must be
  impossible to write to another tenant's repository.
- **Scoping (spec §6 Phase 2 gate):** repo access scoped to instrumented repos only, never
  heuristic-broad.
- The tool returns a failure string when the write fails. It must never claim a success it did not
  get — that is the defect being removed.

- [ ] **Step 1: Write failing tests** — the tool actually persists a row; a write to a repository outside the caller's installation is rejected and writes nothing *(mutation test for the tenant gate)*; an oversized body is rejected, not truncated; exceeding the per-repo row cap is rejected; **a transport failure returns a failure string, not the success string** (the stub's core defect); an unauthenticated call to the endpoint is rejected.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both suites — expect PASS. Capture output.
- [ ] **Step 5:** `git commit -- packages/agents/src/arete_agents/tools packages/agents/tests packages/webhook/src`

**Reviewer focus:** construct a cross-tenant write attempt and confirm it fails at the server, not
only in the client. Confirm the failure path genuinely returns failure — induce a real transport
error rather than mocking only the success case.

---

### Task 9: Dispatch-before-ack audit + regression tests

**Files:** Create tests only, alongside the routes they pin.

The survey found this property already holds in approve
(`containers/[id]/approve/route.ts:57-86`), send (`containers/[id]/send/route.ts:75-97`), and
infra-apply (`remediation.py:93-132`, interrupt-gated and idempotent per `approval_id`). Nothing
needs rewriting. What is missing is **anything stopping a future change from breaking it.**

- [ ] **Step 1: Write regression tests** that fail if the order inverts: when the underlying effect (PR open / staging send / apply) throws or returns non-2xx, the route must **not** advance state to `posted`/`approved` and must **not** return success. Assert on both the persisted state and the status code.
- [ ] **Step 2:** Confirm they pass against current code (this is an audit — green is expected), then **prove they are not vacuous**: temporarily invert the order in one route, show the test fails, revert. Paste both outputs. A regression test never observed failing is decoration.
- [ ] **Step 3:** Record the audit findings in the report, including the one deliberate inversion (`/fix/trigger`'s 202-before-drive) and why it is safe: what the client streams is container *state*, never a completion claim.
- [ ] **Step 4:** `git commit -- <test paths>`

---

### Task 10: Security gate sweep, spec amendment, DoD evidence — **independent review**

- [ ] **Step 1: Spec §6 Phase 2 gates**, each with captured evidence:
  1. Healing-agent repo access scoped to instrumented repos only — show the scoping code and a failing cross-scope attempt.
  2. MCP/internal tokens treated as write credentials **with expiry** — document current expiry behavior; if none exists, that is a finding, not a checkbox.
  3. No secrets in `AGENTS.md` / skill files — grep the canonical pattern set from `packages/telemetry/src/redaction.ts` across `**/AGENTS.md` and `.claude/skills/**`.
  4. Alert receiver auth mutation test (Task 3) demonstrably fails when the guard is removed.
- [ ] **Step 2: Amend the spec.** Add a "Phase 2 amendments (2026-07-21)" block to
      `docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md` §3 recording
      the four scope decisions above and their rationale. Spec §5 conventions remain frozen and
      untouched.
- [ ] **Step 3: File Phase 2b to backlog** — telemetry-fed investigations (needs an internal query
      surface), the fix-pipeline tool loop, plus anything Minor accumulated in the ledger.
- [ ] **Step 4: Write the evidence file BEFORE ticking anything** (retrospective action 6):
      `.superpowers/sdd/phase-2-gate-report.md`, with real captured output.
- [ ] **Step 5: Whole-branch review** on the most capable model, with the review package.
- [ ] **Step 6: PR into `integration-preview`** with the DoD checklist and evidence in the body.

---

## Phase 2 exit criteria (DoD)

- [ ] A **synthetic alert fired into the running stack** produces an `Incident` row, which opens a `WorkItem`, which runs the fix pipeline — end to end, observed, not unit-tested only.
- [ ] The p95 latency rule fires on slow-but-successful runs (proven by a rule test with a boundary case, plus a live check).
- [ ] Fix runs execute on BullMQ under a concurrency cap; a repeated failure is refused with 429 and a `Retry-After` header.
- [ ] `author_patch` is unreachable without grounded findings; a run that cannot ground returns an honest `fix_failed`.
- [ ] `add_project_memory` persists a real row, is tenant-guarded and size-capped, and returns failure when it fails.
- [ ] All four spec §6 Phase 2 gates pass with captured evidence, each with a mutation test.
- [ ] Trace continuity holds through the new queue hop (one trace in Jaeger).
- [ ] CI green, all checks.
