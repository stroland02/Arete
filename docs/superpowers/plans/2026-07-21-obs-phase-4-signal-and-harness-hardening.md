# Phase 4 Implementation Plan — Trustworthy CI Signal + No-Dependency Harness Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a red test line mean a real bug — pay down the keyless/flaky test-signal debt and close the two no-dependency harness gaps (`processGitHubCheckRun` double-retry, MCP token refresh-on-expiry).

**Architecture:** Four workstreams over three disjoint implementer lanes. A (Python conftest) mirrors CI's fake-provider env locally. B+C (one TS lane, same test file) fix the check-run retry parity and harden test isolation. D (Python MCP) adds refresh-on-expiry with fail-closed semantics + `0o600` creds hardening. Every change is verifiable here except MCP end-to-end, which is verified against a mocked token endpoint.

**Tech Stack:** Python 3.12 / pytest / pydantic-settings / httpx; TypeScript / Vitest / BullMQ / Octokit.

**Source spec:** `docs/superpowers/specs/2026-07-21-obs-phase-4-signal-and-harness-hardening-design.md`

## Global Constraints

- **Fail closed on MCP auth.** Never present an expired or unrefreshable token. When a token is past its skew window and cannot be refreshed (no `refresh_token`, no `token_url`, or the refresh POST fails), raise — the caller's existing `try/except` skips that server. No silent stale-token fallback.
- **`os.environ.setdefault`, never overwrite,** for any test-env provisioning — a developer's real key must survive.
- **Disjoint file sets; explicit-file-list commits** (`git add <exact paths>`, never `git add .`); review packages keyed to each agent's reported commit SHA (`<sha>^..<sha>`).
- **B and C share `packages/webhook/src/pipeline.integration.test.ts`** → one implementer lane, executed sequentially (C then B), never two parallel edits to that file.
- **No new bare `print()` in agents *server* code** (`packages/agents/AGENTS.md`). MCP CLI/auth `print()` is pre-existing and CLI-scoped; refresh failures surface via `raise`, not `print`.
- **MCP refresh is verified against a mocked token endpoint only** — there is no live MCP server here. State this ceiling in the PR body.
- **Every new test file runs in CI in the commit that adds it** (Phase 3 retro action 1): MCP tests under the `test-agents` job, check-run tests under `test-webhook` — both already run the relevant suites; verify, don't add matrix rows.
- **Anthropic-key-gated behavior stays deferred** (haiku tier, review `N=8`). Do not touch it.

---

### Task 1 (Workstream A): Keyless test signal — conftest mirrors CI's provider env

**Files:**
- Modify: `packages/agents/tests/conftest.py:24-31` (add provider defaults to the existing `setdefault` block)
- Test: `packages/agents/tests/test_conftest_env.py` (Create)

**Interfaces:**
- Consumes: `arete_agents.config.get_settings` (existing `@lru_cache` accessor).
- Produces: nothing importable; establishes the invariant "the test session always has a usable LLM provider configured."

- [ ] **Step 1: Write the failing test**

Create `packages/agents/tests/test_conftest_env.py`:

```python
from arete_agents.config import get_settings


def test_test_session_always_has_a_usable_provider():
    """Keyless (no ANTHROPIC_API_KEY / GEMINI_API_KEY exported), the suite
    used to leave the default provider = 'anthropic' with no key, so
    Settings() construction raised and ReviewOrchestrator.run() silently fell
    back to blind-merge — masking 9 real full-pipeline assertions. conftest
    now sets CI's fake-gemini env so local == CI and get_settings() always
    constructs. A red line is then a real bug, not a missing key."""
    get_settings.cache_clear()
    settings = get_settings()  # must NOT raise
    assert settings.llm_provider in {"gemini", "anthropic"}
```

- [ ] **Step 2: Run test to verify it fails (keyless)**

Run (with no provider key exported):
```bash
cd packages/agents && env -u ANTHROPIC_API_KEY -u GEMINI_API_KEY -u LLM_PROVIDER uv run pytest tests/test_conftest_env.py -v
```
Expected: FAIL — `ValueError: ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic` (raised from `config.py:95-102` because conftest does not yet set a provider). On Windows/PowerShell where `env -u` is unavailable, temporarily `Remove-Item Env:ANTHROPIC_API_KEY,Env:GEMINI_API_KEY,Env:LLM_PROVIDER -ErrorAction SilentlyContinue` in the shell first.

- [ ] **Step 3: Add the provider defaults to conftest**

In `packages/agents/tests/conftest.py`, immediately after the existing `INTERNAL_TOKEN_TTL_SECONDS` default (currently line 31) and before the `INTERNAL_HEADERS` mint (line 33), add:

```python
# Mirror CI's provider env (ci.yml test-agents job) at collection time so the
# LOCAL keyless sandbox exercises the SAME path CI and prod take, instead of
# the anthropic-default -> Settings() raises -> orchestrator blind-merge
# fallback path that masked 9 real full-pipeline failures. `test-key-not-real`
# is never a valid key: gemini provider construction is lazy (llm/gemini.py),
# every affected test injects a mock LLM, and CI proves no real network call is
# made under this env. setdefault (not overwrite) preserves a developer's real
# key if one is exported.
os.environ.setdefault("LLM_PROVIDER", "gemini")
os.environ.setdefault("GEMINI_API_KEY", "test-key-not-real")
```

(`os` is already imported at `conftest.py:2`.)

- [ ] **Step 4: Run the new test + the full suite keyless to verify 0 failures**

```bash
cd packages/agents && env -u ANTHROPIC_API_KEY -u GEMINI_API_KEY -u LLM_PROVIDER uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q
```
Expected: the new test PASSES and the suite reports **0 failed** (previously 9 failed: the 8 `test_orchestrator.py` full-pipeline tests + `test_pipeline_integration.py::test_large_pr_reviews_all_20_files`). Confirm `test_config.py` and `test_cli.py` still pass (they `patch.dict` + `cache_clear`, so the global default cannot break provider-selection assertions).

- [ ] **Step 5: Confirm red is now real — one-line sabotage check**

Temporarily change the expected count in `tests/test_pipeline_integration.py::test_large_pr_reviews_all_20_files` (e.g. assert `== 121`), run it keyless, confirm it now FAILS on the assertion (not on a `ValueError`), then revert. This proves the masking is gone. Do not commit the sabotage.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/tests/conftest.py packages/agents/tests/test_conftest_env.py
git commit -m "test(agents): mirror CI's provider env in conftest so keyless suite is green-by-default

The anthropic-default keyless path made Settings() raise, dropping run() into
blind-merge and masking 9 real full-pipeline assertions. conftest now sets the
same fake-gemini env CI uses (setdefault, offline-safe) so local == CI and red
== real bug."
```

---

### Task 2 (Workstream C): `processGitHubCheckRun` retry parity + first-ever tests

**Files:**
- Modify: `packages/webhook/src/worker.ts:209-226` (split the shared try/catch)
- Test: `packages/webhook/src/pipeline.integration.test.ts` (add a `check_run` describe block)

**Interfaces:**
- Consumes: exported `processReviewJob(data)` (`worker.ts:298-333`, dispatches `kind: 'check_run'` → `processGitHubCheckRun`); `GitHubCheckRunJobData` shape = the pull_request job fields + `ciLogs` (`queue.ts:56-67`); the existing `buildApp`/`makeOctokit`/`makeRoutedFetchMock` harness (`pipeline.integration.test.ts:102,220,326`).
- Produces: nothing importable; changes only the retry behavior of the CI-diagnosis path.

- [ ] **Step 1: Write the two failing tests**

Append to `packages/webhook/src/pipeline.integration.test.ts`, inside the existing top-level `describe(...)` (so it shares the `beforeEach`/`afterEach` and `mocks`), just before the closing `})` of that describe:

```typescript
  describe('check_run (CI-diagnosis) path retry parity', () => {
    // The pull_request path (Phase 3 Task 10) already distinguishes
    // "no result -> retry" from "result produced, publish failed -> don't
    // retry". processGitHubCheckRun ran the pre-fix shared try/catch, so a
    // publish-only failure re-ran the whole CI-diagnosis LLM pipeline. These
    // pin the same two-branch behavior for check_run.
    const checkRunJob = {
      provider: 'github', kind: 'check_run', owner: 'acme', repo: 'api',
      repositoryExternalId: 1, fullName: 'acme/api', installationId: 42,
      prNumber: 1, headSha: 'abc', ciLogs: 'build failed: TypeError at foo.ts:3',
    }

    it('partial success: pipeline produced a usable result but posting failed -> job does NOT throw (no full-pipeline retry)', async () => {
      mocks.octokit.rest.pulls.createReview.mockRejectedValue(
        Object.assign(new Error('GitHub API rate limited'), { status: 500 })
      )
      await buildApp(mocks)
      const { processReviewJob } = await import('./worker.js')

      await expect(processReviewJob(checkRunJob)).resolves.toBeUndefined()

      expect(mocks.fetchMock).toHaveBeenCalledTimes(1)              // pipeline ran
      expect(mocks.octokit.rest.pulls.createReview).toHaveBeenCalledTimes(1) // publish attempted
      expect(mocks.octokit.rest.checks.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed', conclusion: 'failure' })
      )
      expect(mocks.prisma.reviewCreate).not.toHaveBeenCalled()      // not retried, not re-persisted
    })

    it('genuine infra crash: pipeline yields no result -> job DOES throw (still retried by attempts:3)', async () => {
      const runReviewPipelineMock = vi.fn().mockRejectedValue(
        new Error('Python pipeline exited with status 500: internal error')
      )
      await buildApp(mocks, { runReviewPipeline: runReviewPipelineMock })
      const { processReviewJob } = await import('./worker.js')

      await expect(processReviewJob(checkRunJob)).rejects.toThrow('Python pipeline exited with status 500')
      expect(mocks.octokit.rest.pulls.createReview).not.toHaveBeenCalled()
      expect(mocks.octokit.rest.checks.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed', conclusion: 'failure' })
      )
    })
  })
```

- [ ] **Step 2: Run the tests to verify the partial-success one fails**

Run:
```bash
cd packages/webhook && pnpm test -- pipeline.integration.test.ts -t "check_run"
```
Expected: the **partial success** test FAILS — `processReviewJob(checkRunJob)` rejects (the current shared try/catch re-throws the publish error) instead of resolving. The infra-crash test already passes (that case throws in both the old and new shape).

- [ ] **Step 3: Split the shared try/catch in `processGitHubCheckRun`**

In `packages/webhook/src/worker.ts`, replace the single try/catch (currently lines 209-226) with two independent blocks mirroring the PR path (lines 96-146):

```typescript
  let result
  try {
    result = await runReviewPipeline(prContext)
  } catch (err) {
    // No usable result: genuine infra crash. Re-throwing is correct — BullMQ's
    // attempts:3 (queue.ts) is meant to retry a crash that produced nothing.
    await (octokit as any).rest.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: 'Review Failed',
        summary: `Areté encountered an error while diagnosing this CI failure: ${err instanceof Error ? err.message : String(err)}`,
      },
    })
    throw err
  }

  try {
    await postReview(octokit, owner, repo, prNumber, result)
  } catch (err) {
    // The pipeline DID produce a usable result — only publishing to GitHub
    // failed. Re-throwing would make BullMQ redo the entire CI-diagnosis
    // review (on top of the per-agent retry in the Python service) just to
    // retry a GitHub API call. Record the degraded outcome and return (not
    // throw) so this job is NOT retried; attempts:3 stays reserved for the
    // no-result crash above.
    log.error({ err }, 'Failed to post CI diagnosis (pipeline produced a usable result)')
    await (octokit as any).rest.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: 'Review Post Failed',
        summary: `Areté completed the CI diagnosis but failed to post it to GitHub: ${err instanceof Error ? err.message : String(err)}`,
      },
    })
    return
  }
```

(Leave the subsequent `checks.update` success call at 228-235 and the `persistReview` block at 237-251 unchanged.)

- [ ] **Step 4: Run the tests to verify both pass**

Run:
```bash
cd packages/webhook && pnpm test -- pipeline.integration.test.ts -t "check_run"
```
Expected: both check_run tests PASS. Then run the whole file to confirm no regression: `pnpm test -- pipeline.integration.test.ts`.

- [ ] **Step 5: Mutation check**

Temporarily change the publish-only `return` back to `throw err` in the new second block, rerun the partial-success test, confirm it goes RED, then revert. This proves the test actually guards the no-retry behavior.

- [ ] **Step 6: Commit**

```bash
git add packages/webhook/src/worker.ts packages/webhook/src/pipeline.integration.test.ts
git commit -m "fix(webhook): processGitHubCheckRun must not re-run the pipeline on a publish-only failure

Applies the Task 10 two-block split to the CI-diagnosis path: runReviewPipeline
failure re-throws (retryable crash), postReview failure records a degraded check
run and returns (no full-pipeline retry). Adds the first tests for this path."
```

---

### Task 3 (Workstream B): Harden test isolation + correct the stale "flaky" docs

**Files:**
- Modify: `packages/webhook/src/pipeline.integration.test.ts:331-336` (add a registry-clean assertion to `afterEach`)
- Modify: `docs/roadmap/backlog.md` (correct the stale flaky-test claims)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing importable; adds a regression guard against doMock leakage and fixes documentation.

**Note:** This runs AFTER Task 2 (same file, same implementer lane). The one real flake (order-dependence from `vi.doMock` + `vi.resetModules()`) was already fixed in commit `515b30a`; this task adds a guard so it cannot silently recur, and corrects docs that still call the test flaky.

- [ ] **Step 1: Add a registry-clean assertion to `afterEach`**

In `packages/webhook/src/pipeline.integration.test.ts`, the `afterEach` (lines 331-336) already unmocks the two per-test modules and resets modules. Add an explicit assertion that no test left a stray mock of those modules registered outside `buildApp` — turning the invisible leak that caused `515b30a` into a loud failure:

```typescript
  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.doUnmock('./telemetry/fetch-telemetry-context.js')
    vi.doUnmock('./review-bridge.js')
    vi.resetModules()
    // Regression guard for 515b30a: buildApp is the SINGLE choke point for
    // registering these mocks. If a future test registers one outside
    // buildApp, importing the real module here would return the mock and this
    // assertion fails loudly — instead of silently leaking into a later test
    // and reintroducing the "keep this test LAST" order-dependence.
    const bridge = await import('./review-bridge.js')
    expect(vi.isMockFunction(bridge.runReviewPipeline)).toBe(false)
  })
```

- [ ] **Step 2: Run the full file, plus a randomized-order pass, to verify green**

Run:
```bash
cd packages/webhook && pnpm test -- pipeline.integration.test.ts
cd packages/webhook && pnpm test -- pipeline.integration.test.ts --sequence.shuffle
```
Expected: PASS in both natural and shuffled order (proving order-independence). If `--sequence.shuffle` is unsupported by the installed Vitest, run the file twice and confirm both pass; note the flag limitation in the commit.

- [ ] **Step 3: Correct the stale documentation in the backlog**

In `docs/roadmap/backlog.md`, the Phase 2b list item 8 currently reads that `pipeline.integration.test.ts` "is still flaky" and its Phase-0 "fix or quarantine" criterion "was never met." Replace that item's body with the corrected, evidenced status:

```markdown
8. ~~**`pipeline.integration.test.ts` is still flaky**~~ **RESOLVED.** The one
   real flake — order-dependence from `vi.doMock` + `vi.resetModules()` leaking
   mocks across tests — was fixed in commit `515b30a` (buildApp owns the doMock
   registry). Phase 4 added an `afterEach` registry-clean assertion so the leak
   cannot silently recur, and verified the suite passes under randomized order.
   The test is hermetic (mocks Redis/Postgres/fetch/GitHub; the webhook CI job
   needs no services). Phase 0's "fix or quarantine" criterion is **met**. Left
   struck-through rather than deleted: an entry asserting a live flake that no
   longer exists misstates shipped reality.
```

- [ ] **Step 4: Verify no other doc still asserts the flake**

Run:
```bash
cd "C:/Users/strol/orca/workspaces/Arete/horseshoe" && grep -rn "pipeline.integration.test.ts" docs/ | grep -i "flak"
```
Expected: no remaining live (non-struck-through) assertion that the test is flaky. If another doc (e.g. a Phase-0 retro) asserts it, add a one-line correction pointing at `515b30a` + this phase.

- [ ] **Step 5: Commit**

```bash
git add packages/webhook/src/pipeline.integration.test.ts docs/roadmap/backlog.md
git commit -m "test(webhook): guard pipeline integration suite against doMock leakage; correct stale flaky-test docs

Adds an afterEach registry-clean assertion (regression guard for 515b30a) and
marks Phase 0's fix-or-quarantine criterion met — the test is hermetic and the
real flake was fixed two phases ago."
```

---

### Task 4 (Workstream D): MCP `exchange_refresh_token` grant primitive

**Files:**
- Modify: `packages/agents/src/arete_agents/mcp/auth.py` (add `exchange_refresh_token` beside `exchange_code_for_token:29-83`)
- Test: `packages/agents/tests/test_mcp_auth.py` (add a `TestExchangeRefreshToken` class)

**Interfaces:**
- Consumes: `_default_post` / `PostFn` (`auth.py:15,25`), `TokenExchangeError` (`auth.py:18`).
- Produces: `exchange_refresh_token(token_url: str, refresh_token: str, client_id: str = _CLIENT_ID, post: Optional[PostFn] = None) -> dict` returning `{"access_token": str, "expires_at": float | None, "refresh_token": str | None}`. Task 5 (`get_valid_token`) calls this.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agents/tests/test_mcp_auth.py`:

```python
class TestExchangeRefreshToken:
    def _resp(self, status_code=200, json_body=None, text=""):
        from unittest.mock import MagicMock
        r = MagicMock()
        r.status_code = status_code
        r.text = text
        if json_body is None:
            r.json.side_effect = ValueError("no json")
        else:
            r.json.return_value = json_body
        return r

    def test_refresh_returns_new_token_and_expiry(self):
        from arete_agents.mcp.auth import exchange_refresh_token
        captured = {}

        def fake_post(url, data, headers):
            captured["url"] = url
            captured["data"] = data
            return self._resp(json_body={"access_token": "new-access", "expires_in": 3600, "refresh_token": "new-refresh"})

        out = exchange_refresh_token("https://idp.example/token", "old-refresh", post=fake_post)
        assert out["access_token"] == "new-access"
        assert out["refresh_token"] == "new-refresh"
        assert out["expires_at"] is not None and out["expires_at"] > 0
        assert captured["url"] == "https://idp.example/token"
        assert captured["data"]["grant_type"] == "refresh_token"
        assert captured["data"]["refresh_token"] == "old-refresh"

    def test_refresh_non_2xx_raises_and_fabricates_nothing(self):
        from arete_agents.mcp.auth import exchange_refresh_token, TokenExchangeError
        import pytest
        with pytest.raises(TokenExchangeError):
            exchange_refresh_token("https://idp.example/token", "old-refresh",
                                   post=lambda u, d, h: self._resp(status_code=400, text="bad"))

    def test_refresh_missing_access_token_raises(self):
        from arete_agents.mcp.auth import exchange_refresh_token, TokenExchangeError
        import pytest
        with pytest.raises(TokenExchangeError):
            exchange_refresh_token("https://idp.example/token", "old-refresh",
                                   post=lambda u, d, h: self._resp(json_body={"expires_in": 3600}))
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/agents && uv run pytest tests/test_mcp_auth.py::TestExchangeRefreshToken -v`
Expected: FAIL — `ImportError: cannot import name 'exchange_refresh_token'`.

- [ ] **Step 3: Implement `exchange_refresh_token`**

In `packages/agents/src/arete_agents/mcp/auth.py`, add immediately after `exchange_code_for_token` (after line 83):

```python
def exchange_refresh_token(
    token_url: str,
    refresh_token: str,
    client_id: str = _CLIENT_ID,
    post: Optional[PostFn] = None,
) -> dict:
    """Real `grant_type=refresh_token` exchange against `token_url`.

    A sibling to exchange_code_for_token for renewing an access token that is
    at/near expiry. Same fail-closed contract: raises TokenExchangeError -- and
    NEVER returns a fabricated placeholder -- on transport failure, a non-2xx
    response, an unparsable body, or a response missing `access_token`.

    Returns {access_token, expires_at, refresh_token}; per RFC 6749 the response
    MAY omit refresh_token (the caller keeps the prior one via
    update_server_token, which only overwrites on a non-None value).
    """
    post_fn = post if post is not None else _default_post

    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    try:
        response = post_fn(token_url, data, headers)
    except httpx.HTTPError as exc:
        raise TokenExchangeError(f"could not reach the token endpoint ({exc})") from exc

    if not (200 <= response.status_code < 300):
        raise TokenExchangeError(
            f"token endpoint returned HTTP {response.status_code}: {response.text[:500]}"
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise TokenExchangeError(f"token endpoint returned a non-JSON response ({exc})") from exc

    access_token = payload.get("access_token")
    if not access_token:
        raise TokenExchangeError("token endpoint response is missing 'access_token'")

    expires_in = payload.get("expires_in")
    expires_at = time.time() + expires_in if isinstance(expires_in, (int, float)) else None

    return {
        "access_token": access_token,
        "expires_at": expires_at,
        "refresh_token": payload.get("refresh_token"),
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/agents && uv run pytest tests/test_mcp_auth.py::TestExchangeRefreshToken -v`
Expected: all three PASS. Run `uv run ruff check src/ tests/` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/mcp/auth.py packages/agents/tests/test_mcp_auth.py
git commit -m "feat(mcp): add exchange_refresh_token grant primitive (fail-closed, no fabrication)"
```

---

### Task 5 (Workstream D): `MCPManager.get_valid_token` — refresh-on-expiry

**Files:**
- Modify: `packages/agents/src/arete_agents/mcp/manager.py` (add `get_valid_token` + a skew constant + a typed error; add `import time`, `import os`)
- Test: `packages/agents/tests/test_mcp_manager.py` (Create)

**Interfaces:**
- Consumes: `exchange_refresh_token` (Task 4), existing `get_server` (`manager.py:71`), `update_server_token` (`manager.py:74`).
- Produces: `MCPManager.get_valid_token(name: str, *, now: Optional[float] = None, post=None) -> Optional[str]` — returns a currently-valid access token (refreshing first if within the skew window), `None` if the server is unknown or has no token, and **raises `MCPTokenRefreshError`** when a refresh is required but impossible. Task 6 (`client.py`) calls this. `_REFRESH_SKEW_SECONDS = 60`.

- [ ] **Step 1: Write the failing tests**

Create `packages/agents/tests/test_mcp_manager.py`:

```python
import pytest

from arete_agents.mcp.manager import MCPManager, MCPTokenRefreshError


def _mgr(tmp_path, server):
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": server})
    return m


def test_valid_token_returned_without_refresh(tmp_path):
    m = _mgr(tmp_path, {"token": "live", "expires_at": 10_000, "refresh_token": "r",
                        "token_url": "https://idp/t", "status": "Authenticated"})
    called = {"n": 0}
    out = m.get_valid_token("srv", now=1_000, post=lambda *a, **k: called.__setitem__("n", called["n"] + 1))
    assert out == "live"
    assert called["n"] == 0  # not near expiry -> no refresh POST


def test_no_expiry_info_presents_token_as_is(tmp_path):
    m = _mgr(tmp_path, {"token": "live", "expires_at": None, "refresh_token": None,
                        "token_url": None, "status": "Authenticated"})
    assert m.get_valid_token("srv", now=1_000) == "live"


def test_expired_token_is_refreshed_and_persisted(tmp_path):
    m = _mgr(tmp_path, {"token": "old", "expires_at": 1_000, "refresh_token": "r-old",
                        "token_url": "https://idp/t", "status": "Authenticated"})

    def fake_post(url, data, headers):
        from unittest.mock import MagicMock
        r = MagicMock(); r.status_code = 200
        r.json.return_value = {"access_token": "fresh", "expires_in": 3600, "refresh_token": "r-new"}
        return r

    out = m.get_valid_token("srv", now=1_000, post=fake_post)  # now == expires_at -> within skew
    assert out == "fresh"
    stored = m.get_server("srv")
    assert stored["token"] == "fresh"
    assert stored["refresh_token"] == "r-new"


def test_expired_without_refresh_token_fails_closed(tmp_path):
    m = _mgr(tmp_path, {"token": "old", "expires_at": 1_000, "refresh_token": None,
                        "token_url": "https://idp/t", "status": "Authenticated"})
    with pytest.raises(MCPTokenRefreshError):
        m.get_valid_token("srv", now=2_000)


def test_unknown_server_returns_none(tmp_path):
    m = MCPManager(str(tmp_path))
    assert m.get_valid_token("nope", now=1_000) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/agents && uv run pytest tests/test_mcp_manager.py -v`
Expected: FAIL — `ImportError: cannot import name 'MCPTokenRefreshError'`.

- [ ] **Step 3: Implement `get_valid_token`**

In `packages/agents/src/arete_agents/mcp/manager.py`, add `import os` and `import time` at the top (beside `import json`). Add the error class at module level (above `class MCPManager`) and the constant + method inside the class after `update_server_token`:

```python
class MCPTokenRefreshError(Exception):
    """Raised when an MCP access token is past its skew window and cannot be
    refreshed (no refresh_token, no token_url, or the refresh POST failed).
    Fail closed: the caller must skip the server, never present a stale token."""


# ... inside class MCPManager, after update_server_token:
    _REFRESH_SKEW_SECONDS = 60

    def get_valid_token(self, name: str, *, now: Optional[float] = None, post=None) -> Optional[str]:
        """Return a currently-valid access token for `name`, refreshing first if
        it is within _REFRESH_SKEW_SECONDS of (or past) expiry. Returns None if
        the server is unknown or has no stored token. Raises MCPTokenRefreshError
        if a refresh is required but impossible -- callers fail closed on that.

        `now`/`post` are injectable for testing without a real clock/network."""
        server = self.get_server(name)
        if not server:
            return None
        token = server.get("token")
        if not token:
            return None
        expires_at = server.get("expires_at")
        clock = time.time() if now is None else now
        # No expiry info -> present as-is (matches pre-refresh behavior; some
        # providers issue non-expiring tokens or omit expires_in).
        if expires_at is None:
            return token
        if clock < expires_at - self._REFRESH_SKEW_SECONDS:
            return token

        refresh_token = server.get("refresh_token")
        token_url = server.get("token_url")
        if not refresh_token or not token_url:
            raise MCPTokenRefreshError(
                f"MCP server '{name}' token is expired and cannot be refreshed "
                f"(missing {'refresh_token' if not refresh_token else 'token_url'})."
            )

        from .auth import TokenExchangeError, exchange_refresh_token
        try:
            result = exchange_refresh_token(token_url, refresh_token, post=post)
        except TokenExchangeError as exc:
            raise MCPTokenRefreshError(f"MCP token refresh for '{name}' failed: {exc}") from exc

        self.update_server_token(
            name,
            access_token=result["access_token"],
            expires_at=result["expires_at"],
            refresh_token=result["refresh_token"],
        )
        return result["access_token"]
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/agents && uv run pytest tests/test_mcp_manager.py -v`
Expected: all five PASS. Run `uv run ruff check src/ tests/` — clean.

- [ ] **Step 5: Mutation check**

Temporarily change the fail-closed branch to `return token` instead of raising, rerun `test_expired_without_refresh_token_fails_closed`, confirm it goes RED, then revert. Proves the fail-closed guard is enforced.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/mcp/manager.py packages/agents/tests/test_mcp_manager.py
git commit -m "feat(mcp): get_valid_token refreshes near-expiry tokens, fails closed when it can't"
```

---

### Task 6 (Workstream D): Route the Bearer through `get_valid_token` + `0o600` creds file

**Files:**
- Modify: `packages/agents/src/arete_agents/mcp/client.py:126-130` (materialize the token via `get_valid_token`)
- Modify: `packages/agents/src/arete_agents/mcp/manager.py:20-23` (`_save_config` writes `0o600`)
- Test: `packages/agents/tests/test_mcp_client.py` (add a routing test), `packages/agents/tests/test_mcp_manager.py` (add a file-mode test)

**Interfaces:**
- Consumes: `MCPManager.get_valid_token` (Task 5).
- Produces: nothing importable; the live Bearer path now refreshes-or-fails-closed, and the creds file is owner-only.

- [ ] **Step 1: Write the failing file-mode test**

Append to `packages/agents/tests/test_mcp_manager.py`:

```python
import os
import stat
import sys


def test_config_file_is_owner_only(tmp_path):
    if sys.platform == "win32":
        pytest.skip("POSIX file modes not enforced on Windows")
    m = MCPManager(str(tmp_path))
    m._save_config({"srv": {"token": "secret"}})
    mode = stat.S_IMODE(os.stat(m.config_file).st_mode)
    assert mode == 0o600, f"creds file mode is {oct(mode)}, expected 0o600"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/agents && uv run pytest tests/test_mcp_manager.py::test_config_file_is_owner_only -v`
Expected: FAIL on non-Windows — mode is the umask default (e.g. `0o644`), not `0o600`.

- [ ] **Step 3: Harden `_save_config`**

In `packages/agents/src/arete_agents/mcp/manager.py`, replace `_save_config` (lines 20-23) with:

```python
    def _save_config(self, config: Dict[str, Any]) -> None:
        # The file holds real OAuth access + refresh tokens in cleartext, so it
        # must be owner-only. mkdir the parent 0o700 and chmod the file 0o600
        # after write (chmod is a no-op on Windows, harmless).
        self.config_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with open(self.config_file, "w") as f:
            json.dump(config, f, indent=2)
        try:
            os.chmod(self.config_file, 0o600)
        except (OSError, NotImplementedError):
            pass
```

(`import os` was added in Task 5; if executing Task 6 independently, ensure it is present.)

- [ ] **Step 4: Run to verify the file-mode test passes**

Run: `cd packages/agents && uv run pytest tests/test_mcp_manager.py -v`
Expected: all PASS (the new file-mode test passes on POSIX, skips on Windows).

- [ ] **Step 5: Write the failing routing test**

Append to `packages/agents/tests/test_mcp_client.py`:

```python
def test_connect_http_uses_get_valid_token(monkeypatch, tmp_path):
    """get_mcp_tools_for_agent must materialize the Bearer via
    MCPManager.get_valid_token (refresh-on-expiry / fail-closed), not read the
    raw stored 'token' field directly."""
    import arete_agents.mcp.client as client_mod
    from arete_agents.mcp.manager import MCPManager

    monkeypatch.setattr(client_mod, "HAS_MCP", True)
    monkeypatch.setattr(client_mod, "_ensure_bg_loop", lambda: object())

    m = MCPManager(str(tmp_path))
    m._save_config({"srv": {
        "transport": "http", "target": "https://mcp.example/sse", "status": "Authenticated",
        "token": "should-not-be-read-directly", "expires_at": None,
        "refresh_token": None, "token_url": None, "allowed_agents": ["all"],
    }})
    monkeypatch.setattr(client_mod, "MCPManager", lambda *_a, **_k: m)

    calls = {"valid": 0}
    real_get_valid = m.get_valid_token

    def spy_get_valid(name, **kw):
        calls["valid"] += 1
        return real_get_valid(name, **kw)
    monkeypatch.setattr(m, "get_valid_token", spy_get_valid)

    # Stop before any real event-loop / MCP connect: make the scheduling call
    # raise so the connect branch is exercised only up to token materialization.
    def _stop(*_a, **_k):
        raise RuntimeError("stop before real MCP connect")
    monkeypatch.setattr(client_mod.asyncio, "run_coroutine_threadsafe", _stop)

    client_mod.get_mcp_tools_for_agent("reviewer", str(tmp_path))
    assert calls["valid"] == 1  # token materialized via get_valid_token, not details['token']
```

> Implementer note: the exact stubbing may need adjusting to how `_connect_http` is scheduled (it is wrapped in `asyncio.run_coroutine_threadsafe`, whose failure is swallowed by the branch's own `try/except` at `client.py:131-133`, so the function returns `[]` cleanly). The assertion that MUST hold is `calls["valid"] == 1` — the connect path called `get_valid_token`, proving the Bearer is no longer read straight from `details['token']`. Adjust the stub to whatever makes that assertion reachable without a real event loop.

- [ ] **Step 6: Run to verify failure**

Run: `cd packages/agents && uv run pytest tests/test_mcp_client.py::test_connect_http_uses_get_valid_token -v`
Expected: FAIL — `get_valid_token` is never called (client still reads `details.get("token")`), so `calls["valid"] == 0`.

- [ ] **Step 7: Route the Bearer through `get_valid_token`**

In `packages/agents/src/arete_agents/mcp/client.py`, in `get_mcp_tools_for_agent`, change the http-connect branch (lines 126-130). Replace `details.get("token")` with a `manager.get_valid_token(...)` call, letting a refresh failure propagate into the existing `except` (which skips the server — fail-closed):

```python
                elif details["transport"] == "http":
                    # Materialize the Bearer via get_valid_token so a near-expiry
                    # token is refreshed first, and an unrefreshable expired token
                    # fails closed (MCPTokenRefreshError -> caught below -> server
                    # skipped) instead of being presented stale.
                    token = manager.get_valid_token(server_name)
                    future = asyncio.run_coroutine_threadsafe(
                        _connect_http(server_name, details["target"], token), loop
                    )
                    future.result(timeout=10)
```

- [ ] **Step 8: Run to verify pass + full MCP suite**

Run:
```bash
cd packages/agents && uv run pytest tests/test_mcp_client.py tests/test_mcp_manager.py tests/test_mcp_auth.py -v && uv run ruff check src/ tests/
```
Expected: all PASS, ruff clean.

- [ ] **Step 9: Commit**

```bash
git add packages/agents/src/arete_agents/mcp/client.py packages/agents/src/arete_agents/mcp/manager.py packages/agents/tests/test_mcp_client.py packages/agents/tests/test_mcp_manager.py
git commit -m "feat(mcp): present Bearer via get_valid_token (refresh/fail-closed) + chmod creds file 0o600"
```

---

### Task 7: Update the backlog's deferred items + phase closeout

**Files:**
- Modify: `docs/roadmap/backlog.md` ("Deferred from Phase 3" block)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Mark the two closed items and re-file the deferred remainder**

In `docs/roadmap/backlog.md`, under "Deferred from Phase 3": strike through item 2 (MCP refresh) noting refresh-on-expiry + `0o600` shipped in Phase 4 while **discovery/DCR remains deferred**, and strike through item 4 (`processGitHubCheckRun`) noting the retry parity fix shipped. Leave items 1 (haiku tier) and 3 (`N=8` tuning) as-is (still Anthropic-key-gated). Add a short "Deferred from Phase 4" note carrying forward MCP discovery/DCR with its evidence (`auth.py:170-171` synthesizes the auth URL; `client_id` hardcoded `auth.py:12`).

- [ ] **Step 2: Commit**

```bash
git add docs/roadmap/backlog.md
git commit -m "docs(backlog): close Phase 4 items (checkRun retry, MCP refresh+0o600); carry MCP discovery/DCR forward"
```

---

## Self-Review

**Spec coverage:**
- Workstream A (keyless tests) → Task 1. ✅
- Workstream B (TS harden + doc correction) → Task 3. ✅
- Workstream C (checkRun retry + first test) → Task 2. ✅
- Workstream D (MCP refresh + `0o600`, discovery/DCR deferred) → Tasks 4, 5, 6. ✅
- DoD item 5 (new tests run in existing CI jobs) → verified in each task's run step (MCP under `test-agents`, checkRun under `test-webhook`). ✅
- DoD item 6 (deferred re-filed) → Task 7. ✅
- Verifiability ceiling for D (mocked endpoint only) → Tasks 4-6 use injected `post`/`now`, no live server; PR body note called out in Global Constraints. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Task 6 Step 5 carries an explicit implementer note about stubbing the async connect — the required assertion is stated concretely (`calls["valid"] == 1`), not left vague. ✅

**Type consistency:** `exchange_refresh_token(token_url, refresh_token, client_id?, post?) -> {access_token, expires_at, refresh_token}` (Task 4) is consumed by `get_valid_token` (Task 5) with matching kwargs; `get_valid_token(name, *, now?, post?) -> Optional[str]` (Task 5) is consumed by `client.py` (Task 6) as `manager.get_valid_token(server_name)`; `MCPTokenRefreshError` defined in Task 5, caught by the existing `except` in Task 6. `update_server_token` signature matches `manager.py:74-80`. ✅

## Execution Handoff

Sequencing: **Task 1 (lane A)**, **Tasks 4→5→6 (lane D)**, and **Task 2→3 (lane B+C)** are three disjoint lanes that can run concurrently; Task 7 lands last (touches `backlog.md`, which Task 3 also edits — sequence Task 7 after Task 3). Within lane D, Tasks 4→5→6 are strictly ordered (each consumes the prior). Within lane B+C, Task 2 precedes Task 3 (same file).
