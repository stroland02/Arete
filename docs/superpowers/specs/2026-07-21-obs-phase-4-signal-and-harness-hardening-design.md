# Phase 4 Design — Trustworthy CI Signal + No-Dependency Harness Hardening

**Initiative:** SUPERLOG observability (`2026-07-20-superlog-observability-integration-design.md`)
**Predecessor:** Phase 3 (`docs/roadmap/2026-07-21-phase-3-retrospective.md`), merged into `integration-preview` at `266deb1`.
**Date:** 2026-07-21 · **Author:** stroland02 (brainstormed)
**Branch (planned):** `stroland02/obs-phase-4` off `integration-preview@266deb1`

---

## 1. Goal

Make a red test line mean a **real bug**. Phase 3's revocation failure was one red line among nine
environmental reds; a suite that is red-by-default in the local sandbox actively masks real failures
(retrospective actions 2 and 4). Phase 4 pays down that signal debt and closes the two concrete harness
gaps that need **no Anthropic key and no production volume** — so every task is fully implementable and
verifiable in this environment.

The scope was chosen by the user as **"Signal + no-dependency hardening"** over the alternatives
(measurement-gated tuning; the displaced tenant-telemetry platform), precisely because those alternatives
cannot be verified here and this one can.

## 2. Non-goals (explicitly deferred)

Each stays in the backlog with its evidence; none is dropped:

- **Haiku fix-authoring adequacy** and **review `max_concurrency` N=8 tuning** — both require a real
  Anthropic key + a real large PR to measure. Changing them blind is the failure mode this phase avoids.
- **MCP RFC 8414 discovery + dynamic client registration** — speculative until a real MCP server needs
  it, and nothing here validates it. Deferred by explicit user decision (MCP scope = "refresh + hardening
  only").
- **The tenant-telemetry platform** (two-tier ingest edge, tenancy strip-then-stamp, fingerprint
  grouping, rollups, retention/consent) — multi-subsystem; needs its own decomposition and spec.

## 3. Workstreams

Four workstreams, grounded in a read-only investigation of the actual code (findings and file:line
evidence below). Two premises from the backlog were corrected by that investigation and are called out.

### Workstream A — Python keyless test signal *(fully verifiable here)*

**Finding.** Keyless (`ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `LLM_PROVIDER` all unset), the agents suite
is **9 failed / 515 passed**. All 9 are full-pipeline assertions in `tests/test_orchestrator.py` and
`tests/test_pipeline_integration.py`. Root cause, precisely:

- `llm_provider` defaults to `"anthropic"` (`config.py:20`); the `anthropic_key_required` validator
  raises `ValueError` on `Settings()` construction when the key is empty (`config.py:95-102`).
- `ReviewOrchestrator.run()` calls `get_settings()` inside a `try` at `orchestrator.py:661` to read
  `review_max_concurrency`; the `except` at `orchestrator.py:667` swallows the `ValueError` and runs the
  degraded **blind-merge fallback** (`orchestrator.py:670+`), which skips the real LangGraph fan-out /
  synthesizer / critic.
- The 9 tests inject a **mock/cyclic LLM** (`conftest.py:84-93`) and assert full-pipeline behavior
  (e.g. `test_large_pr_reviews_all_20_files` expects 120 file_reviews = 20×6, gets 20 from blind-merge,
  `test_pipeline_integration.py:248`). **No network is touched** — they fail solely because
  `get_settings()` refuses to construct.

Running the same command with CI's env (`LLM_PROVIDER=gemini GEMINI_API_KEY=test-key-not-real`,
`ci.yml:32-34`) → **524 passed**. The failures are purely a missing-provider-env artifact.

**Fix.** In `packages/agents/tests/conftest.py`, alongside the existing internal-token `setdefault` block
(`conftest.py:24-31`), add:

```python
os.environ.setdefault("LLM_PROVIDER", "gemini")
os.environ.setdefault("GEMINI_API_KEY", "test-key-not-real")
```

Rationale — this makes **local == CI**:

- **Offline-safe, and CI is the proof.** CI already runs the entire suite with exactly this env in the
  process and passes with no network; `test-key-not-real` is not a valid key, so a real Gemini call would
  401 and turn CI red — none does. Gemini provider construction is lazy (`llm/gemini.py:18,29`) and the 9
  tests use mock LLMs that never build it.
- **`setdefault` (not overwrite)** preserves a developer's real key if present.
- **Provider-selection tests are immune** — they `patch.dict("os.environ", ...)` for the specific keys
  they test and call `get_settings.cache_clear()` (`test_config.py:8,17,30,40`; `test_cli.py:45-46`); CI
  proves this (all of `test_config` passes under the same env).

This is retrospective **action 2** ("security-critical env-dependent paths need the default sandbox to
exercise the prod-condition path") made concrete for the whole suite.

**Verification:** keyless `pytest tests/ --ignore=tests/test_e2e_smoke.py` goes from 9-failed to 0-failed;
CI stays green; a deliberately-broken assertion in one of the 9 now shows as the *only* red line.

### Workstream B — TS integration test: harden, don't quarantine *(premise was stale)*

**Finding (premise corrected).** The backlog lists `pipeline.integration.test.ts` as "still flaky" with an
unmet Phase-0 "fix or quarantine" criterion. Investigation shows the test is **already hermetic** — it
mocks `./queue.js`, `@arete/db`, global `fetch`, `./github-auth.js`, and the octokit packages (test lines
179-201, 242-310); importing the real `./worker.js` opens no Redis because `startReviewWorker`'s
`Worker`+`IORedis` live behind the entry-point guard `worker.ts:405`. The webhook CI job correctly starts
**no** services (`ci.yml:36-101`). The one real flake — order-dependence from `vi.doMock` +
`vi.resetModules()` leaking mocks across tests — was **already fixed** in commit `515b30a`, which made
`buildApp` own the doMock registry (invariant comment at test lines 222-240, `afterEach` at 331-336).

**Fix.** *Harden, do not quarantine.* Quarantine would delete the only end-to-end proof of
webhook→queue→worker→review→post — including the no-double-retry semantics commit `71e5b2c` encodes.

- Make `buildApp` the **single choke-point** for all mock registration so a future test cannot
  reintroduce cross-test leakage, and add an `afterEach` assertion that the doMock registry is clean.
- **Correct the stale documentation:** mark Phase 0's "fix or quarantine" criterion **met** and update the
  backlog entries that call this test flaky (they misstate shipped reality — the same hazard as a stale
  security claim).

**Verification:** the suite passes under randomized test order (or with the isolation assertion in place);
the backlog/exit-criteria docs no longer assert a flake that doesn't exist.

### Workstream C — `processGitHubCheckRun` retry parity + first-ever test *(fully verifiable here)*

**Finding.** `processGitHubCheckRun` (`worker.ts:191-254`) still wraps `runReviewPipeline` **and**
`postReview` in one shared `try` and re-throws on any failure (`worker.ts:209-226`) — the exact pre-Task-10
shape. A publish-only failure (usable review produced, GitHub publish hiccups) therefore re-triggers
BullMQ `attempts:3` (`queue.ts:159-164`) and re-runs the **entire** CI-diagnosis LLM pipeline from scratch,
on top of each agent's own `with_retry`. The partial/infra distinction is **semantically identical** to the
PR path: both call the same `runReviewPipeline`→Python `/review`, which is resolve-or-throw with no
partial-then-throw (`review-bridge.ts:58-68`); partial-agent failure is absorbed inside the orchestrator
and still returns a 200 result (`orchestrator.py:497-500`).

**Fix.** Apply the Task-10 shape (`worker.ts:97-146`): split into two `try/catch` blocks — one around
`runReviewPipeline` alone that **re-throws** (genuine infra crash → legitimately retryable), one around
`postReview` alone that records a degraded check-run conclusion and **`return`s** (usable result, publish
failed → must not retry). This is a semantically-correct application, not a blind copy.

**Test (first for this path).** Add tests to `pipeline.integration.test.ts` driving a
`check_run.completed` payload, reusing the existing `buildApp` / `capturedJobs` / exported `processReviewJob`
harness (`worker.ts:298-333`) plus the `ciLogs` field (`queue.ts:56-67`): assert (1) pipeline-throws →
job rejects (retried), (2) partial-success + publish-throws → job resolves, check run `failure`,
`createReview` not re-invoked.

**Integration point — B and C are one coordinated change.** The new check-run tests live *in
`pipeline.integration.test.ts`*, the same file Workstream B hardens. To respect the disjoint-file-set rule,
**B and C are implemented together by a single implementer** (worker.ts + that test file), not as two
parallel edits to the same file.

**Verification:** the two new tests pass; a mutation that re-throws in the publish-only branch turns the
"partial-success → resolves" test red.

### Workstream D — MCP refresh-on-expiry + creds-file hardening *(mock-token-endpoint verifiable only)*

**Finding.** Phase 3's exchange **persists** `expires_at`/`refresh_token` (`auth.py:76-83`,
`manager.py:74-94`) but **nothing consumes them**: no comparison of `expires_at` against `time.time()`, no
`grant_type=refresh_token` request anywhere, no `get_valid_token()` accessor. The token is materialized at
the single choke point `client.py:110-133` (`get_mcp_tools_for_agent`, `details.get("token")`) and presented
verbatim at the lone Bearer site `client.py:51` — an expired token is presented until a human re-runs
`mcp auth`. Separately, `.agents/mcp_servers.json` is written plaintext with **default permissions**
(`manager.py:20-23`; no `chmod`/`0o600`), holding real access + refresh tokens.

**Fix.**

1. Add `MCPManager.get_valid_token(name)`: read `expires_at`; if within a skew window (or past), and a
   `refresh_token` exists, perform a `grant_type=refresh_token` POST (a sibling to
   `exchange_code_for_token`, `auth.py:29-83`) against the stored `token_url`, persist the new token via
   the existing `update_server_token` (`manager.py:74-80`, already accepts `expires_at`/`refresh_token`),
   and return the valid access token. **Fail closed** on refresh error (no `refresh_token`, no `token_url`,
   non-2xx) exactly as Phase 3's exchange does — surface the failure, do not present a stale token silently.
2. Route the Bearer materialization (`client.py:129`) through `get_valid_token()`.
3. Harden `_save_config` to write the file `0o600` (and create the parent dir with restrictive mode).

**Honest verifiability ceiling.** There is **no live MCP server** here to prove refresh end-to-end. The
refresh path is verified against a **mocked authorization server** (a fake token endpoint returning a new
access token for a `refresh_token` grant), mirroring Phase 3's existing exchange tests
(`test_mcp_auth.py:44-102`), plus expiry-window / clock-skew / fail-closed unit tests and a file-mode
(`0o600`) test. The plan states this ceiling explicitly; end-to-end MCP validation is out of reach until a
real server exists.

**Deferred (per user decision):** RFC 8414 `.well-known` discovery and dynamic client registration remain
backlog items — none exists today (`client_id` is the hardcoded `"arete-client"`, `auth.py:12`) and nothing
here validates such a flow.

## 4. Verifiability ceilings (stated up front)

| Workstream | Ceiling |
|---|---|
| A (keyless tests) | **Full.** Keyless local run + CI both provable green; red = real bug. |
| B (TS harden) | **Full.** Randomized-order run + registry-clean assertion. |
| C (checkRun retry) | **Full.** New tests + a mutation prove the no-retry branch. |
| D (MCP refresh) | **Partial — mocked token endpoint only.** No live MCP server exists; end-to-end refresh is not provable here, and the plan says so rather than implying it. |

## 5. Sequencing & parallelization (disjoint file sets)

Retains Phase 3's collision discipline (disjoint file sets, explicit-file-list commits, review packages
keyed to each agent's reported SHA). Safe concurrent width:

- **A** — `packages/agents/tests/conftest.py` (Python). Disjoint.
- **B + C together** — `packages/webhook/src/worker.ts` + `packages/webhook/src/pipeline.integration.test.ts`
  (one implementer; the two workstreams share the test file, so they must not be split across agents).
- **D** — `packages/agents/src/arete_agents/mcp/{manager,auth,client}.py` + `tests/test_mcp_auth.py`
  (Python; disjoint from A — A touches only `conftest.py`, D does not).
- **Docs** — the backlog / Phase-0-exit-criteria corrections (Workstream B's doc half) land with B.

A and (B+C) and D are three disjoint implementer lanes → up to three concurrent implementers plus
overlapping read-only reviews. Reviews on security-relevant chunks (D's refresh/fail-closed path, A's
env-default's effect on the provider-selection tests) get full review with a mutation on the fail-closed
branch; B/C/A mechanics get spot-checks.

## 6. Definition of Done

1. **Keyless local `pytest` is 0-failed** on the agents suite (from 9); CI stays green; a broken assertion
   in one of the previously-masked 9 shows as the sole red line.
2. **`pipeline.integration.test.ts` passes under randomized order** (or with the registry-clean assertion),
   and the backlog / Phase-0 exit-criteria docs no longer assert it is flaky.
3. **`processGitHubCheckRun` no longer re-throws on a publish-only failure**, proven by a new test in the
   integration suite and a mutation that turns the no-retry assertion red.
4. **MCP presents a refreshed token when `expires_at` is within the skew window**, proven against a mocked
   token endpoint; fail-closed on refresh error; the creds file is `0o600`. The mock-only ceiling is stated
   in the PR body.
5. **New package/interface CI rule honored:** any new test file is exercised by CI in the same commit that
   creates it (retrospective action 1) — here that means the new MCP refresh tests run under the existing
   `test-agents` job and the checkRun tests under `test-webhook`, verified before merge.
6. Whole-branch review confirms no cross-workstream regression; deferred items re-filed with evidence.

## 7. Deferred / carried forward

Re-filed in `docs/roadmap/backlog.md` with evidence: MCP discovery/DCR; haiku fix-authoring adequacy;
review `N=8` tuning; the tenant-telemetry platform. The corrected "flaky test" claim is removed from the
backlog as part of Workstream B rather than carried forward.
