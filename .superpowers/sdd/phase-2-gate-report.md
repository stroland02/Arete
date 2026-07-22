# Phase 2 Gate Report — security gates + DoD evidence

**Branch:** `stroland02/obs-phase-2` · **Base:** `integration-preview@b491e60` · **Task 10**
**Captured:** 2026-07-21, against commit `bdba033` (working tree clean; all mutations reverted and re-verified).
**Plan:** [`docs/superpowers/plans/2026-07-21-obs-phase-2-healing-alerting.md`](../../docs/superpowers/plans/2026-07-21-obs-phase-2-healing-alerting.md)
**Spec:** [`docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md`](../../docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md) §6

> **Evidence first, checkmarks after** (Phase 1 retrospective action 6). Everything below is
> captured output from a real run. Where something could not be verified, it says so and the
> corresponding DoD box is **not** ticked.

---

## 0. Environment used

Live stack, `infra/docker-compose.yml`: postgres, redis, clickhouse, jaeger, prometheus,
alertmanager, otel-collector. Application processes started by hand for this run:

| Process | How | Port |
|---|---|---|
| `arete-agents` | `uv run uvicorn arete_agents.server:app` | **8011** (see trap 2) |
| `arete-webhook` | `npx tsx --env-file=../../.env --import ./src/otel.ts src/index.ts` | 3001 |
| `arete-worker` | `npx tsx --env-file=../../.env --import ./src/otel-worker.ts src/worker.ts` | — |

`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` is set in this checkout's `.env`, so telemetry
was **on** for the whole run (unset ⇒ silent no-op; Task 5's ledger note).
`ARETE_PLATFORM_INSTALLATION_ID=11111111-1111-4111-8111-111111111111` was exported for the webhook
and worker and points at a **real `Installation` row** (seeded below) — without it the C1 fix drops
every alert and the chain is inert by design.

### Seed data (real GitHub identities, not fabricated ids)

The dev database was empty at the start of this run. `Installation.externalId` was taken from the
GitHub App's own `GET /app/installations` so the fix drive could mint a **real** installation token:

```
installations: [ { id: 146880121, account: "stroland02" }, { id: 146436108, account: "areteservices02-create" } ]
repos(146880121): [ { id: 1302212198, full: "stroland02/beancount-sandbox", def: "main" } ]
```

Seeded rows:

```
Installation 11111111-1111-4111-8111-111111111111  externalId=146880121  owner=stroland02   <- platform owner
Repository   22222222-2222-4222-8222-222222222222  stroland02/beancount-sandbox
ModelConnection 33333333-...  provider=ollama  model=qwen2.5-coder:latest  baseUrl=http://localhost:11434
Installation 44444444-4444-4444-8444-444444444444  externalId=990002  owner=victim-tenant   <- cross-tenant probe target
Repository   55555555-5555-4555-8555-555555555555  victim-tenant/secrets
```

### Three environment traps hit during this run

Recorded because the Phase 2 retrospective's standing rule is *"when a verification fails, suspect
the environment before the code"* — all three cost time and none was a code defect.

1. **The running Alertmanager container predated its own compose fix.** `docker ps` showed
   `0.0.0.0:9093->9093/tcp` while `infra/docker-compose.yml` says `127.0.0.1:9093:9093` (the C1
   remediation). A container does not re-read its port mapping on restart — it must be **recreated**.
   After `docker compose up -d alertmanager`: `infra-alertmanager-1  127.0.0.1:9093->9093/tcp`, and
   `/run/secrets/internal_api_token` present at 64 bytes. Same class as Phase 1's
   non-hot-reloading collector.
2. **A stale `uvicorn` squatting on :8000.** It served `/openapi.json` with a `/review` route but
   answered `GET /health` → `{"detail":"Not Found"}` — i.e. a **pre-Phase-1 build** of the agents
   service from an earlier session, which also predates the B4 auth guard. Had this run used
   `PYTHON_SERVICE_URL=http://127.0.0.1:8000` (the checked-in default) the whole fix leg would have
   been verified against unauthenticated, uninstrumented code while appearing to work. The fresh
   service was started on **:8011** instead. This is the second stale-port incident of the project.
3. **`set -a; . ./.env` silently zeroes `GITHUB_PRIVATE_KEY`.** The value begins
   `-----BEGIN RSA PRIVATE KEY-----\n…`; POSIX `sh` word-splits on the spaces and errors with
   `RSA: command not found`, leaving the variable **empty**. The webhook then dies with
   `Configuration error: GITHUB_PRIVATE_KEY is required`, but the *worker* starts happily and would
   have failed later at token mint for a reason that looks like GitHub. Use `--env-file` (dotenv
   semantics), never shell sourcing.

Also noted, not a trap: `GEMINI_API_KEY` is **empty** in this checkout, so the agents service logged
`No usable primary LLM provider key configured; falling back to local Ollama` and the fix run
executed against a local `qwen2.5-coder:latest`. Real LLM, zero API spend, no cloud provider
exercised.

---

## 1. Spec §6 Phase 2 security gates

### Gate 1 — Healing-agent repo access scoped to instrumented repos only ✅ PASS

**Scoping code.** Every repo resolution on the healing path is scoped by the caller's own
`installationId`; none is a name-first ("heuristic-broad") lookup:

| Surface | Query |
|---|---|
| `fix/trigger.ts:276` (the fix drive's own repo) | `repository.findFirst({ where: { installationId: item.installationId }, orderBy: { createdAt: 'asc' } })` |
| `alerting/incident.ts:234` (alert-born fix runs) | `repository.findFirst({ where: { installationId: incident.installationId } })` |
| `memory-write.ts:214` (the healing agent's write-back) | `repository.findFirst({ where: { installationId: installation.id, fullName: repoFullName } })` |
| `scan/trigger.ts:101`, `context-map/file-content.ts:94` | both `{ where: { installationId } }` |

The agent-facing side is stronger than a check: `tools/memory.py::build_memory_tool(installation_id,
repo_full_name)` **closure-binds** the tenant, so `repo_full_name` is not a tool argument the model
can supply at all. And `grep` confirms `saveAgentMemory` is now the *only* caller of
`prisma.agentMemory.create` in the webhook package — the old unscoped `findFirst({ fullName })` in
`chat-handler.ts` is gone (comment at `chat-handler.ts:109` records the removal).

**Mutation test (unit).** Drop the tenant scope from the lookup — `where: { installationId,
fullName }` → `where: { fullName }`, with the fake store's `findFirst` relaxed to match so the
mutation faithfully models *an unscoped query* rather than a broken one:

```
FAIL  src/memory-write.test.ts > saveAgentMemory > rejects a write to a repository outside the caller installation and persists nothing
AssertionError: expected { ok: true, id: 'mem-1' } to deeply equal { ok: false, reason: 'repo_not_found' }
- Expected                          + Received
-   "ok": false,                    +   "id": "mem-1",
-   "reason": "repo_not_found",     +   "ok": true,
 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
```

Exactly one test fails, and it is the gate's own test. Reverted → `Tests 20 passed (20)`,
`git diff` empty.

**Live cross-scope attempt** against the running webhook + real Postgres (installation `146880121`
naming the *other* tenant's repo):

```
=== 4. CROSS-TENANT (inst A names victim repo) ===
{"ok":false,"reason":"repo_not_found"}
HTTP 404

rows for the victim repo (must be 0): 0
```

`repo_not_found`/404 is deliberately identical to the genuinely-missing-repo case, so a caller
cannot distinguish "wrong tenant" from "does not exist".

---

### Gate 2 — MCP/internal tokens treated as write credentials **with expiry** ❌ **FINDING, NOT A PASS**

Half the gate holds and half does not. Recorded as a finding per the brief: *"if internal tokens
have no expiry, that is a finding, not a checkbox."*

**What holds.** The internal token *is* treated as a write credential: constant-time comparison
(`timingSafeEqual`), fail-closed 503 when unconfigured, 401 on absent/wrong, and it now guards every
write-or-spend route on both services (webhook `/internal/*`, `/scan/trigger`, `/staging/send`,
`/fix/trigger`, `/alerts/incoming`; agents `/review /scan /fix /chat /approvals/apply
/context-map/index` + both context-map GETs). Live control from this run:

```
POST /fix/trigger        (no token)     -> HTTP 401
POST /internal/memory    (no token)     -> HTTP 401
POST /internal/memory    (wrong token)  -> HTTP 401
POST /internal/memory    (real token)   -> HTTP 201 {"ok":true,"id":"640608e8-…"}
```

**What does not hold: there is no expiry, and expiry is not expressible.**

`INTERNAL_API_TOKEN` is a single static shared secret read from the environment per request
(`internal-auth.ts:43`). There is no issuance time, no `exp`, no `iat`, no rotation counter, no
revocation list, no TTL. A repo-wide grep of `rotat|expir|issued_at|iat|exp` across `.env.example`,
`docker-compose.prod.yml`, `packages/webhook/src/internal-auth.ts`,
`packages/dashboard/src/lib/internal-auth.ts` and
`packages/agents/src/arete_agents/internal_auth.py` returns **zero** matches.

Probe (throwaway test, run then deleted):

```
PROBE: status now = 200 | status +10y = 200
PROBE: tokenMatches arity = 2 (header, token) — no exp/iat input exists
 Test Files  1 passed (1)   Tests  2 passed (2)
```

The middleware authenticates the same token identically with the system clock set to 2036. Its
comparison function takes `(header, token)` and nothing else — **there is no clock in the code path
at all**, so this gate cannot be given a mutation test: you cannot observe a nonexistent property
failing. That absence is the evidence.

**The MCP half is worse.** `mcp/manager.py` stores each server's token in
`.agents/mcp_servers.json` as plaintext JSON (`json.dump`, default file mode, no `chmod`), with the
schema `{transport, target, status, token, allowed_agents}` — **no expiry field exists to populate**.
`mcp/client.py:51` sends `Authorization: Bearer {token}` forever. And `mcp/auth.py:90` never
exchanges the authorization code at all — it fabricates `f"simulated_token_for_{code}"`, so there is
no `expires_in` from a provider to store even if the schema had a slot for it. The MCP OAuth flow is
a **stub**, not a credential system.

**Contrast, to be fair to the code:** the credential that reaches a *customer's repository* — the
GitHub App installation token — **does** expire (GitHub-enforced ~1h) and is minted fresh per fix
drive (`fix.token.mint` span in the live trace below). The expiry gap is on the internal/MCP
surface, not the SCM surface.

**Disposition:** gate **unmet**. Filed to `docs/roadmap/backlog.md` under "Phase 2b" with the
evidence above. Not fixed in this task: adding expiry is a credential-lifecycle design decision
(rotation window, dual-token overlap so a rotation does not break in-flight service-to-service
calls, and a decision on whether MCP grows a real OAuth exchange), not a patch.

---

### Gate 3 — No secrets in `AGENTS.md` / skill files ✅ PASS (one adjudicated false positive)

Scanner derives its patterns **by parsing** `packages/telemetry/src/redaction.ts` rather than
copying them, so the gate cannot drift from the canonical set:

```
canonical value patterns: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi  /\bsk-[A-Za-z0-9_-]{10,}/g
                          /\bgh[pousr]_[A-Za-z0-9]{16,}/g  /\bglpat-[A-Za-z0-9_-]{10,}/g
                          /\bwhsec_[A-Za-z0-9]{10,}/g
                          /([?&](?:key|api_key|apikey|token|access_token|client_secret)=)[^&\s'"]+/gi
canonical redact keys   : authorization, x-api-key, api_key, apikey, token, secret, password, cookie, set-cookie
```

(The `REDACT_KEYS` half is applied as a `key: value` / `key=value` prose matcher with an 8-char
minimum value, since a key blocklist otherwise has nothing to bind to in Markdown.)

Result over all 8 in-repo steering/skill files:

```
HIT  .claude\skills\instrument-every-feature\SKILL.md:54  /([?&](?:key|api_key|…)=)[^&\s'"]+/  ->  "?key=`/`?api_key=`"
     `sk-`/`ghp_`/`ghs_`/`glpat-`/`whsec_` keys, `?key=`/`?api_key=` URL params.

scanned 8 files
  .claude/skills/debug-from-telemetry/SKILL.md
  .claude/skills/instrument-every-feature/SKILL.md
  AGENTS.md
  packages/agents/AGENTS.md
  packages/agents/CLAUDE.md
  packages/dashboard/AGENTS.md
  packages/dashboard/CLAUDE.md
  packages/telemetry/AGENTS.md

HITS: 1
```

**The single hit is the skill file documenting the pattern set itself** — the literal text
``?key=`/`?api_key=`` describing what gets redacted. No credential material. Adjudicated as a false
positive; left in place because rewording the doc to evade its own scanner would be worse.

**Mutation test.** Plant `ghp_0123456789abcdefABCD` in `packages/telemetry/AGENTS.md`:

```
HIT  packages\telemetry\AGENTS.md:19  /\bgh[pousr]_[A-Za-z0-9]{16,}/  ->  "ghp_0123456789abcdefABCD"
HITS: 2
scanner-exit=1
```

Scanner exits **1** and names the file and line. Reverted; `git diff` empty.

---

### Gate 4 — Alert-receiver auth guard fails when removed ✅ PASS

**Mutation.** `server.ts:316`, `server.post('/alerts/incoming', requireInternalToken,
express.json(), …)` → `server.post('/alerts/incoming', express.json(), …)`:

```
FAIL src/server.test.ts > POST /alerts/incoming route wiring > 401s a request with NO internal token and writes no row (mutation test for the gate)
AssertionError: expected 200 to be 401
FAIL src/server.test.ts > … > 401s a request with a WRONG internal token
FAIL src/server.test.ts > … > STILL 401s an unauthenticated malformed body — auth failure remains the only non-2xx
 Test Files  1 failed (1)
      Tests  3 failed | 6 passed | 19 skipped (28)
```

Reverted → `Tests 9 passed | 19 skipped (28)`, `git diff` empty. The third failure is worth noting:
it proves the I4 error-middleware fix did not open a hole — a *malformed* body from an
unauthenticated caller still 401s rather than falling into the 2xx-for-Alertmanager branch.

**Live control** on the running server (same run as the E2E below): an unauthenticated
`POST /fix/trigger` → `HTTP 401`; the authenticated one → `HTTP 202`.

---

### Gate summary

| Gate | Verdict | Mutation test |
|---|---|---|
| 1 · repo access scoped to instrumented repos only | ✅ PASS | unit mutation (1 test fails, the right one) + live cross-tenant 404 with 0 rows |
| 2 · internal/MCP tokens as write credentials **with expiry** | ❌ **FINDING** | **impossible to write** — no clock exists in the code path; that is the finding |
| 3 · no secrets in AGENTS.md / skill files | ✅ PASS | planted `ghp_…` → scanner exit 1 |
| 4 · alert-receiver auth | ✅ PASS | guard removed → 3 tests fail |

---

## 2. Phase 2 exit criteria (DoD) — item by item

### DoD 1 — synthetic alert → Incident → WorkItem → fix pipeline, end to end, observed ✅ **MET**

Driven against the running stack, not unit-tested. The alert deliberately carried a **spoofed
tenancy label** and **two planted secrets**, so this single run also re-proves C1 and the sink
redaction live.

```
POST http://127.0.0.1:9093/api/v2/alerts   -> HTTP 200
  labels:      { alertname: AreteReviewErrorRate, severity: critical,
                 installationId: "VICTIM-INSTALLATION-SPOOF" }
  annotations: { summary: "DoD synthetic alert 2026-07-21 (task 10)",
                 description: "planted secret ghp_0123456789abcdefABCD and https://x.io/a?token=supersecret123" }
```

Alertmanager accepted and grouped it (`fingerprint a276dc30431726b3`), then forwarded to the
webhook receiver after `group_wait: 30s`. Resulting rows:

```
Incident
 id           8714ef8f-8daa-4ced-83dd-1cecd4778711
 installationId 11111111-1111-4111-8111-111111111111   <- PLATFORM, not the spoofed label
 fingerprint  a276dc30431726b3    alertName AreteReviewErrorRate
 severity     critical            status firing
 workItemId   e68e482c-a7be-4a2a-b433-64d2e5644803     <- routed

WorkItem e68e482c-…  kind=error  dimension=deployment_safety  confidence=0.9
                     state=open  containerId=6349b3d0-…  fixFailureCount=1
```

**Tenancy (C1) live:** the attacker-supplied `installationId` survives only as inert scrubbed
payload data; the row is owned by the configured platform installation.

**Redaction live:**

```
summary: DoD synthetic alert 2026-07-21 (task 10)
payload: {"labels": {...,"installationId": "VICTIM-INSTALLATION-SPOOF"},
          "annotations": {"summary": "...", "description": "planted secret [REDACTED] and https://x.io/a"}}

raw-secret survival count (ghp_… OR supersecret123): 0
```

**The fix pipeline actually ran.** `IssueContainer 6349b3d0-…` transcript:

```
[{"kind":"dispatch","text":"Authoring a fix on qwen2.5-coder:latest"},
 {"kind":"compose","text":"finding 'AreteReviewErrorRate': no evidence at all",
  "report":{"agent":"deployment_safety","status":"blocked","confidence":0,
            "blockers":["finding 'AreteReviewErrorRate': no evidence at all"]}},
 {"kind":"drop","text":"Fix failed — no_grounded_findings"}]
```

worker: `{"component":"fix-queue-consumer","jobId":"3","msg":"Job completed"}`
agents: `fix: no grounded findings for container 6349b3d0-… — refusing to author a patch`

The terminal outcome is an **honest `fix_failed`**, not a failure of the chain: an alert-born
WorkItem carries no `path:line` evidence, so Task 7's findings-first gate correctly refused to reach
`author_patch`. This is the designed behaviour and it also discharges DoD 4 (below) live.

**What is genuinely covered by this run:** Prometheus rule name → Alertmanager → authenticated HTTP
→ receiver → scrub → `Incident` upsert → `incident.route` → `WorkItem` + `IssueContainer` → BullMQ
enqueue → cross-process worker → `driveFix` → real installation-token mint against **api.github.com**
→ agents `POST /fix` (authenticated) → **real repo checkout** → findings gate → settle.
**What is not:** a *successful* patch being authored and verified, because the gate correctly
refused. A green-path fix run is exercised by Task 14's own live verification, not re-run here.

---

### DoD 2 — p95 latency rule fires on slow-but-successful runs ✅ **MET**

`promtool test rules` over `infra/prometheus-rules/arete-alerts.test.yml`:

```
  SUCCESS
```

The firing case's input series are explicitly `outcome="success"` — that is what makes it a
*slow-but-successful* test rather than an error test:

```yaml
- series: 'arete_review_duration_seconds_bucket{outcome="success",trigger="pull_request",le="180"}'
  values: '0+10x45'
- series: 'arete_review_duration_seconds_bucket{outcome="success",trigger="pull_request",le="300"}'
  values: '0+100x45'
alert_rule_test:
  - eval_time: 35m
    alertname: AreteReviewLatencyP95
    exp_alerts: [ { exp_labels: { severity: warning }, … } ]
```

and the annotation says so in words: *"Reviews may still be succeeding but are degrading — invisible
to error-rate alerting alone."* The **boundary case** (bucket shape engineered so
`histogram_quantile(0.95, …) ≈ 178.8s`, just under the 180s threshold) asserts `exp_alerts: []` for
the whole run — that is the mutation test for this rule.

**Live check** — `GET http://localhost:9090/api/v1/rules`:

```
group arete-alerts  file /etc/prometheus/rules/arete-alerts.yml  lastError: ["none","none","none"]
   AreteReviewErrorRate   | state inactive | health ok | for 600 | sev critical
   AreteReviewLatencyP95  | state inactive | health ok | for 900 | sev warning
   AreteQueueFailureRate  | state inactive | health ok | for 600 | sev critical
```

And — closing the Phase-1 double-prefix defect class — the series the rules query **actually exist**
under those names on the live exporter (`http://localhost:8889/metrics`):

```
arete_fix_duration_seconds_bucket   arete_fix_runs_total       arete_incidents_routed_total
arete_incidents_total               arete_queue_jobs_total     arete_review_duration_seconds_bucket
arete_review_duration_seconds_count arete_review_duration_seconds_sum
arete_review_runs_total
```

The live `histogram_quantile(0.95, sum by (le) (rate(arete_review_duration_seconds_bucket[15m])))`
resolves (returns `NaN` — no review traffic in the window — rather than "no such metric").

**Honest limit:** the rule was not *observed firing* in the live Prometheus, which would require
15 minutes of synthetic degraded review traffic. Firing behaviour is proven by `promtool`; the live
check proves the rule loads, evaluates, and references real series names.

---

### DoD 3 — fix runs on BullMQ under a concurrency cap; repeated failure refused 429 + `Retry-After` ✅ **MET**

Worker boot, live:

```
{"component":"worker","concurrency":5,"msg":"Areté review worker starting"}
{"component":"worker","msg":"Areté approval-exec worker starting"}
{"component":"worker","concurrency":2,"msg":"Areté fix-drive worker starting"}
```

`FIX_QUEUE_CONCURRENCY = 2`, in a **separate process** from the HTTP server — the defect Task 5
existed to fix (`void driveFix(...)` on the webhook request process) is gone. The live trace below
shows `add fix-drive` (webhook) and `process fix-drive` (worker) as parent/child across Redis.

**Cooldown, live.** The DoD-1 run left `WorkItem e68e482c-…` at `fixFailureCount=1`,
`fixFailureAt=2026-07-21 20:58:50`. An immediate authenticated re-trigger:

```
POST /fix/trigger (Bearer)  -> HTTP 202 {"started":true}

worker log:
{"component":"fix-cooldown","workItemId":"e68e482c-…","retryAfterSeconds":234,"msg":"fix cooldown active — retrigger refused"}
{"component":"fix-queue-consumer","workItemId":"e68e482c-…","retryAfterSeconds":234,"msg":"Fix job dropped — cooldown active"}

WorkItem after: state=open  fixFailureCount=1  fixFailureAt=2026-07-21 20:58:50.318   (unchanged — no second drive)
```

234s remaining of the 300s base window, and **no second checkout or LLM call happened**.

**The 429 + `Retry-After` half is verified by test, not live**, and I am flagging that rather than
blurring it. The 429 lives on the dashboard route
(`packages/dashboard/src/app/api/work-items/[id]/fix/route.ts:43-49`,
`{ status: 429, headers: { 'Retry-After': String(cooldown.retryAfterSeconds) } }`), which is
session-authenticated; the running dashboard on :3002 redirected my probe to `/login`, and minting a
real session was judged not worth the cost. Its suite:

```
✓ POST /api/work-items/[id]/fix > 401 when unauthenticated
✓ POST /api/work-items/[id]/fix > 404 for an unknown or cross-tenant item
✓ POST /api/work-items/[id]/fix > 409 when the item is not open
✓ POST /api/work-items/[id]/fix > 429 with a Retry-After header when a recent failure is still within its cooldown window
✓ POST /api/work-items/[id]/fix > allows a retry once the cooldown window has elapsed
✓ POST /api/work-items/[id]/fix > 200 happy path when there is no prior failure
```

Both cooldown enforcement points therefore have evidence: the **consumer arm live**, the **HTTP arm
by test**.

---

### DoD 4 — `author_patch` unreachable without grounded findings; honest `fix_failed` ✅ **MET**

Proven **live** as part of DoD 1 rather than only by `pytest`. The alert-born WorkItem's evidence
array is empty, so:

```
agents: fix: no grounded findings for container 6349b3d0-… (finding 'AreteReviewErrorRate': no evidence at all) — refusing to author a patch
container transcript: {"kind":"drop","text":"Fix failed — no_grounded_findings"}
container state: fix_failed
metric: arete_fix_runs_total{outcome="fix_failed",stage="findings"} 1
```

The `stage="findings"` dimension shows the run terminated **at the gate**, before patch authoring.
Unit coverage remains green in the agents suite (489 passed) — including the non-vacuous rejection
tests the ledger records (`evidence_path_that_does_not_exist_in_checkout_is_rejected`,
`evidence_quote_not_present_in_the_file_read_this_run_is_rejected`).

---

### DoD 5 — `add_project_memory` persists a real row, tenant-guarded, size-capped, honest failure ✅ **MET**

All four properties driven over real HTTP against the running webhook and real Postgres.

```
=== 1. UNAUTHENTICATED ===      HTTP 401
=== 2. WRONG TOKEN ===          HTTP 401
=== 3. HAPPY PATH ===           {"ok":true,"id":"640608e8-37ce-413a-bdab-ecd0402d9772"}   HTTP 201
=== 4. CROSS-TENANT ===         {"ok":false,"reason":"repo_not_found"}                    HTTP 404
=== 5. OVERSIZED BODY ===       {"ok":false,"reason":"body_too_long",
                                 "detail":"body is 4001 chars after redaction; max is 4000"}  HTTP 400
```

Persisted rows (note the redaction, and that the cross-tenant attempt wrote nothing):

```
 id        | title                      | body                                        | kind
 640608e8… | DoD live write             | remember: key [REDACTED] and https://x.io/a | project
 4b7060f2… | DoD python-tool live write | DoD python-tool live write                  | project

raw-secret survival (ghp_… OR leakme123): 0
rows for victim repo:                      0
```

**The original defect is dead.** The real Python tool (real `_default_post`, real `httpx`) driven
three ways:

```
SUCCESS PATH : Successfully saved project memory: 'DoD python-tool live write'
200-text/html: Failed to save memory: rejected by server (<html>login</html>).
TRANSPORT ERR: Failed to save memory: could not reach the persistence service ([WinError 10061] …refused it).
```

A server answering `200 text/html` — the exact shape that made the reviewer's probe report
"Successfully saved" with nothing persisted — now yields a **failure string**. The success arm wrote
row `4b7060f2…`, confirmed above.

---

### DoD 6 — all four spec §6 Phase 2 gates pass with captured evidence and a mutation test ❌ **NOT MET**

Three of four pass with mutation tests (§1). **Gate 2 (token expiry) is a finding, not a pass**, and
by construction has no mutation test — the property does not exist to be observed failing. Ticking
this box would be the exact behaviour the brief forbids.

---

### DoD 7 — trace continuity holds through the new queue hop ✅ **MET**

One trace, `b7d92490d4201d84498fbe5414dcff12`, **81 spans across three services**, from the
Alertmanager POST through Redis into a different OS process and on over HTTP into Python:

```
services: arete-webhook, arete-worker, arete-agents

ROOT                              | arete-webhook  POST
  incident.receive                | arete-webhook    (pg SELECT/INSERT …)
    incident.route                | arete-webhook    (pg INSERT WorkItem / IssueContainer, UPDATE Incident)
      add fix-drive.fix-drive     | arete-webhook  <-- producer
        process fix-drive         | arete-worker   <-- DIFFERENT PROCESS, direct child through Redis
          fix.run                 | arete-worker
            fix.resolve           | arete-worker
            fix.token.mint        | arete-worker      -> POST (api.github.com), tls.connect
            fix.container.advance | arete-worker
            fix.agents.call       | arete-worker      -> POST
              POST /fix           | arete-agents   <-- SECOND SERVICE HOP
                fix.run           | arete-agents
                  fix.checkout    | arete-agents
                  fix.findings    | arete-agents
            fix.container.settle  | arete-worker
  complete fix-drive              | arete-worker
```

`bullmq-otel` propagation through Redis and W3C propagation over HTTP both hold in one unbroken
parent/child chain. Span names match spec §5's frozen tree (`fix.run` with stage children).

**Cardinality (Global Constraint 1) at runtime.** Every new metric's live dimension set is closed —
no installation ids, repo names, or fingerprints:

```
arete_incidents_total{alertName="AreteReviewErrorRate",severity="critical",status="firing"} 1
arete_incidents_routed_total{reason="routed"} 1
arete_fix_runs_total{outcome="fix_failed",stage="findings"} 1
arete_queue_jobs_total{queue="fix-drive",outcome="completed"} 2
```

---

### DoD 8 — CI green, all checks ⚠️ **NOT VERIFIED HERE**

No PR was opened (the orchestrator owns that step), so GitHub Actions has not run this branch.
What *was* run locally, at `bdba033` with a clean tree:

| Check | Result |
|---|---|
| `@arete/webhook` tests | **70 files, 474 passed** |
| `@arete/dashboard` tests | **81 files, 458 passed** |
| `@arete/telemetry` tests | **4 files, 45 passed** |
| agents (`pytest`, `test:agents`) | **489 passed, 5 warnings in 30.55s** |
| `tsc --noEmit` — webhook | exit 0 |
| `tsc --noEmit` — dashboard | exit 0 |
| `tsc --noEmit` — telemetry | exit 0 |
| `promtool test rules` | SUCCESS |

This box stays **unticked** until CI reports on the PR.

---

## 3. DoD scoreboard

| # | Criterion | Verdict |
|---|---|---|
| 1 | Synthetic alert → Incident → WorkItem → fix pipeline, observed end to end | ✅ **MET** |
| 2 | p95 rule fires on slow-but-successful runs (rule test + boundary + live check) | ✅ **MET** |
| 3 | Fix runs on BullMQ under a concurrency cap; repeat failure refused 429 + `Retry-After` | ✅ **MET** (429 arm by test; consumer arm live) |
| 4 | `author_patch` unreachable without grounded findings; honest `fix_failed` | ✅ **MET** (live) |
| 5 | `add_project_memory` persists, tenant-guarded, size-capped, honest failure | ✅ **MET** (live) |
| 6 | All four spec §6 Phase 2 gates pass, each with a mutation test | ❌ **NOT MET** — gate 2 is a finding |
| 7 | Trace continuity through the new queue hop | ✅ **MET** (81 spans, 3 services) |
| 8 | CI green, all checks | ⚠️ **NOT VERIFIED** — no PR yet; local suites all green |

**6 of 8 met, 1 unmet with a named finding, 1 pending CI.**

---

## 4. Concerns carried out of this task

1. **Gate 2 is genuinely open.** A static, never-expiring shared bearer guards every write and every
   spend path on two services, and is the credential the agents process uses when writing into a
   tenant's memory store. Compromise is permanent until a human notices and edits `.env`.
   Filed to backlog as the top Phase 2b security item.
2. **The MCP OAuth flow is a stub that fabricates tokens** (`auth.py:90`). It is not wired into the
   review/fix paths today, but it stores plaintext credentials in a repo-local JSON file with no
   expiry field and a `Bearer` client that will present them indefinitely. Anything that starts
   depending on MCP inherits that.
3. **Two of the three environment traps this run hit were stale containers/processes serving
   pre-fix code** while looking healthy. The compose file and the running stack had drifted on a
   *security-relevant* setting (Alertmanager's host binding). Worth a `docker compose up -d` before
   any verification that claims to test infra config.
4. **DoD 3's 429 arm and DoD 2's live-firing arm are both test-backed rather than
   observed-in-production-shape.** Neither gap is a code doubt; both are cost decisions, stated so
   the PR reviewer can price them rather than assume they were covered.
