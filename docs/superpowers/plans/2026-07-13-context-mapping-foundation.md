# Context-Mapping Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `agents` review pipeline a real, queryable code-graph of each installation's repository — via a persistent per-installation git clone plus the open-source `codebase-memory-mcp` binary — so a later plan (Sub-project B, not this one) can let opus-tier review agents grep/query the whole codebase instead of only the PR diff.

**Architecture:** The webhook mints a short-lived GitHub App installation token and attaches it (plus a clone URL and installation id) to the existing `PRContext` payload it already POSTs to `agents`. `agents` clones-or-pulls that repo into a local cache directory keyed by installation id, then drives the `codebase-memory-mcp` binary as a stdio MCP server (reusing the existing generic MCP client plumbing) to index it. Every step is best-effort and fails open — a context-mapping problem must never break a code review. A small `agents` HTTP endpoint lazily starts the tool's built-in 3D graph-viewer binary per installation, for later dashboard consumption.

**Tech Stack:** Python 3.12 (`arete_agents`, pytest), TypeScript/Node (`webhook`, vitest), `codebase-memory-mcp` v0.9.0 (MIT, static binary, via `mcp` stdio transport), Docker.

## Global Constraints

- **Anti-fabrication:** any status reported about the index (last-indexed time, whether it's available) must be honest — never imply "live" when it's stale, never show a placeholder graph when no index exists yet.
- **Lightweight over full infra:** no persistent volume in v1. The per-installation clone is a warm cache for the container's lifetime only; a restart means the next review re-clones.
- **Tenant isolation:** every cache directory, MCP server name, and indexed "project" name is keyed by GitHub `installationId`. Installation tokens are never logged or persisted to disk.
- **Fail-open, always:** every function this plan adds that can fail (git clone/pull, binary missing, subprocess start, indexing) must be caught at the call site closest to the review pipeline (`ReviewOrchestrator.run`) so a failure here degrades to "no context map for this review," never a failed review.
- **No new interactive/OAuth machinery:** do not route through `arete_agents/mcp/manager.py` or `mcp/auth.py` (built for interactive third-party OAuth servers). Use the existing low-level stdio session plumbing in `mcp/client.py` directly.
- **Testing convention:** fake the boundary (subprocess, MCP session), never require the real `codebase-memory-mcp` binary or network access in the default test run. Match the existing `unittest.mock.MagicMock` + `.with_retry.return_value = mock`-style faking used in `tests/test_critic.py`.
- **Package lanes:** `packages/agents` (primary), `packages/webhook` (small, additive — two new `PRContext` fields populated, one new auth helper), `packages/agents/Dockerfile` (infra). **`packages/dashboard` is explicitly out of scope for this plan** — it is under heavy concurrent development by other agents (Marble & Ink migration, a `dashboards-service` page, an `/agents` workspace) and a merge conflict was already observed there this session. The dashboard-side graph iframe route from the spec's "Visual" section is deferred to a follow-up task for whoever next works in that package; this plan delivers the `agents`-side endpoint it will call.
- **Scope correction vs. the spec's Architecture section:** the spec lists a `context_map/tools.py` that would wrap the index into LangChain tools for review agents to call. That has no caller in this plan — agents actually calling tools mid-review is Sub-project B, explicitly out of scope here (see the spec's own "Out of Scope" section). Building `tools.py` now would be unused scaffolding (YAGNI). This plan instead ships the two generic primitives `tools.py` would need (`mcp/client.py`'s `get_or_create_session`/`call_tool_sync`, Task 3) so Sub-project B can build `tools.py` cheaply on top of them when there's a real consumer.

---

### Task 1: Thread clone credentials through PRContext (webhook → agents)

**Files:**
- Modify: `packages/agents/src/arete_agents/models/pr.py`
- Modify: `packages/agents/tests/test_models.py`
- Modify: `packages/webhook/src/types.ts`
- Modify: `packages/webhook/src/github-auth.ts`
- Modify: `packages/webhook/src/github-auth.test.ts`
- Modify: `packages/webhook/src/worker.ts`
- Create: `packages/webhook/src/worker.test.ts`

**Interfaces:**
- Produces: `PRContext.clone_url: str | None`, `PRContext.installation_token: str | None`, `PRContext.installation_id: int | None` (Python, all optional — every existing caller that doesn't set them keeps working unchanged).
- Produces (TS): `PRContext.cloneUrl?: string`, `PRContext.installationToken?: string`, `PRContext.installationId?: number`.
- Produces: `getInstallationToken(app: App, installationId: number): Promise<string>` in `github-auth.ts`.
- Produces: `buildCloneContext(fullName: string, installationId: number, installationToken: string): { cloneUrl: string; installationToken: string; installationId: number }` in `worker.ts`.

- [ ] **Step 1: Write the failing Python test**

Add to `packages/agents/tests/test_models.py` (append at end of file):

```python
def test_pr_context_accepts_clone_context_fields():
    from arete_agents.models.pr import FileChange, PRContext

    pr = PRContext.model_validate({
        "repo": "acme/api", "pr_number": 1, "title": "t", "description": "d",
        "files": [], "cloneUrl": "https://github.com/acme/api.git",
        "installationToken": "ghs_abc123", "installationId": 42,
    })
    assert pr.clone_url == "https://github.com/acme/api.git"
    assert pr.installation_token == "ghs_abc123"
    assert pr.installation_id == 42


def test_pr_context_clone_fields_default_to_none():
    from arete_agents.models.pr import PRContext

    pr = PRContext(repo="acme/api", pr_number=1, title="t", description="d", files=[])
    assert pr.clone_url is None
    assert pr.installation_token is None
    assert pr.installation_id is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agents && uv run pytest tests/test_models.py -k clone_context -v`
Expected: FAIL — `AttributeError` or unexpected-keyword validation error, since `clone_url`/`installation_token`/`installation_id` don't exist on `PRContext` yet.

- [ ] **Step 3: Add the fields to PRContext**

In `packages/agents/src/arete_agents/models/pr.py`, add three fields at the end of the `PRContext` class (after `predecessor_root_cause`):

```python
    # Populated by the webhook (best-effort) so agents can clone-and-index
    # the repository for context-mapping. All three are optional together —
    # CLI/eval/local callers omit them and context-mapping is simply
    # skipped for that review (see arete_agents/context_map).
    clone_url: str | None = Field(None, alias="cloneUrl")
    installation_token: str | None = Field(None, alias="installationToken")
    installation_id: int | None = Field(None, alias="installationId")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agents && uv run pytest tests/test_models.py -k clone_context -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Update the TypeScript PRContext type**

In `packages/webhook/src/types.ts`, add three optional fields to the `PRContext` interface (after `telemetryConnectors?`):

```ts
export interface PRContext {
  repo: string
  pr_number: number
  title: string
  description: string
  files: FileChange[]
  customRules?: string[]
  ciLogs?: string
  telemetry?: TelemetrySnapshot[]
  telemetryConnectors?: TelemetryConnectorConfig[]
  cloneUrl?: string
  installationToken?: string
  installationId?: number
}
```

- [ ] **Step 6: Write the failing test for getInstallationToken**

Append to `packages/webhook/src/github-auth.test.ts`:

```ts
describe('getInstallationToken', () => {
  it('calls app.octokit.auth with installation type and returns the token', async () => {
    const mockAuth = vi.fn().mockResolvedValue({ token: 'ghs_abc123' })
    const mockApp = { octokit: { auth: mockAuth } }
    const { getInstallationToken } = await import('./github-auth.js')
    const result = await getInstallationToken(mockApp as any, 42)
    expect(mockAuth).toHaveBeenCalledWith({ type: 'installation', installationId: 42 })
    expect(result).toBe('ghs_abc123')
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @arete/webhook test github-auth -- -t getInstallationToken`
Expected: FAIL — `getInstallationToken` is not exported from `./github-auth.js`.

- [ ] **Step 8: Implement getInstallationToken**

Append to `packages/webhook/src/github-auth.ts`:

```ts
export async function getInstallationToken(app: App, installationId: number): Promise<string> {
  const auth = (await app.octokit.auth({ type: 'installation', installationId })) as { token: string }
  return auth.token
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @arete/webhook test github-auth -- -t getInstallationToken`
Expected: PASS (1 passed)

- [ ] **Step 10: Write the failing test for buildCloneContext**

Create `packages/webhook/src/worker.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildCloneContext } from './worker.js'

describe('buildCloneContext', () => {
  it('builds an https clone URL and carries the installation token/id', () => {
    const result = buildCloneContext('acme/api', 42, 'ghs_abc123')
    expect(result).toEqual({
      cloneUrl: 'https://github.com/acme/api.git',
      installationToken: 'ghs_abc123',
      installationId: 42,
    })
  })
})
```

- [ ] **Step 11: Run test to verify it fails**

Run: `pnpm --filter @arete/webhook test worker.test -- -t buildCloneContext`
Expected: FAIL — `buildCloneContext` is not exported from `./worker.js`.

- [ ] **Step 12: Implement buildCloneContext and wire it into both GitHub process functions**

In `packages/webhook/src/worker.ts`:

Add near the top, alongside the other type-only imports (after the existing `import type { Octokit } from '@octokit/core'` line):

```ts
import type { PRContext } from './types.js'
```

Change the import from `./github-auth.js` to also bring in the new function:

```ts
import { createApp, getInstallationOctokit, getInstallationToken } from './github-auth.js'
```

Add this exported function right after the imports (before `processGitHubPullRequest`):

```ts
/**
 * Pure helper so the clone-URL construction is unit-testable without
 * mocking the whole Octokit/BullMQ call chain. GitHub accepts an
 * installation access token as the HTTPS Basic-auth username on a clone
 * URL — that substitution happens agents-side (arete_agents.context_map.repo_cache),
 * not here; this function only builds the plain clone URL and carries the
 * token alongside it.
 */
export function buildCloneContext(
  fullName: string,
  installationId: number,
  installationToken: string
): Pick<PRContext, 'cloneUrl' | 'installationToken' | 'installationId'> {
  return {
    cloneUrl: `https://github.com/${fullName}.git`,
    installationToken,
    installationId,
  }
}
```

Change the signature of `processGitHubPullRequest` from:

```ts
async function processGitHubPullRequest(octokit: Octokit, data: GitHubPullRequestJobData): Promise<void> {
```

to:

```ts
async function processGitHubPullRequest(octokit: Octokit, installationToken: string, data: GitHubPullRequestJobData): Promise<void> {
```

and, immediately after the existing `prContext.telemetry = await fetchTelemetryContext(...)` block inside that function, add:

```ts
  Object.assign(prContext, buildCloneContext(fullName, installationId, installationToken))
```

Change the signature of `processGitHubCheckRun` from:

```ts
async function processGitHubCheckRun(octokit: Octokit, data: GitHubCheckRunJobData): Promise<void> {
```

to:

```ts
async function processGitHubCheckRun(octokit: Octokit, installationToken: string, data: GitHubCheckRunJobData): Promise<void> {
```

and, immediately after the existing `prContext.ciLogs = ciLogs` line inside that function, add:

```ts
  Object.assign(prContext, buildCloneContext(fullName, installationId, installationToken))
```

Finally, in `processReviewJob`, change:

```ts
  if (data.provider === 'github') {
    const app = createApp()
    const octokit = await getInstallationOctokit(app, data.installationId)
    if (data.kind === 'pull_request') {
      await processGitHubPullRequest(octokit, data)
    } else {
      await processGitHubCheckRun(octokit, data)
    }
    return
  }
```

to:

```ts
  if (data.provider === 'github') {
    const app = createApp()
    const octokit = await getInstallationOctokit(app, data.installationId)
    const installationToken = await getInstallationToken(app, data.installationId)
    if (data.kind === 'pull_request') {
      await processGitHubPullRequest(octokit, installationToken, data)
    } else {
      await processGitHubCheckRun(octokit, installationToken, data)
    }
    return
  }
```

- [ ] **Step 13: Run test to verify it passes**

Run: `pnpm --filter @arete/webhook test worker.test -- -t buildCloneContext`
Expected: PASS (1 passed)

- [ ] **Step 14: Run full webhook and agents suites to confirm no regressions**

Run: `pnpm --filter @arete/webhook test`
Expected: all passing (baseline 18 + 2 new = 20 passed)

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py`
Expected: all passing (baseline count + 2 new = passed, 0 failed)

- [ ] **Step 15: Commit**

```bash
git add packages/agents/src/arete_agents/models/pr.py packages/agents/tests/test_models.py \
  packages/webhook/src/types.ts packages/webhook/src/github-auth.ts packages/webhook/src/github-auth.test.ts \
  packages/webhook/src/worker.ts packages/webhook/src/worker.test.ts
git commit -m "feat(context-map): thread clone URL + installation token through PRContext"
```

---

### Task 2: Per-installation repo cache (clone-or-pull)

**Files:**
- Create: `packages/agents/src/arete_agents/context_map/__init__.py` (empty for now — populated in Task 4)
- Create: `packages/agents/src/arete_agents/context_map/repo_cache.py`
- Create: `packages/agents/tests/test_repo_cache.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `RepoCacheError(Exception)`, `ensure_repo_checked_out(clone_url: str, installation_token: str, installation_id: int, repo_slug: str, root: Path = DEFAULT_REPOS_ROOT) -> Path`, `DEFAULT_REPOS_ROOT: Path`. Task 4 imports `RepoCacheError` and `ensure_repo_checked_out` from this module.

- [ ] **Step 1: Create the package and write the failing tests**

Create `packages/agents/src/arete_agents/context_map/__init__.py`:

```python
```

(empty file — this becomes the `ensure_indexed` module in Task 4)

Create `packages/agents/tests/test_repo_cache.py`:

```python
from unittest.mock import MagicMock, patch

import pytest

from arete_agents.context_map.repo_cache import (
    RepoCacheError,
    _with_token,
    ensure_repo_checked_out,
)


def test_with_token_injects_https_basic_auth():
    url = _with_token("https://github.com/acme/api.git", "ghs_abc123")
    assert url == "https://x-access-token:ghs_abc123@github.com/acme/api.git"


def test_with_token_rejects_non_https_url():
    with pytest.raises(RepoCacheError):
        _with_token("git@github.com:acme/api.git", "ghs_abc123")


def test_ensure_repo_checked_out_clones_when_not_present(tmp_path):
    root = tmp_path / "repos"
    fake_result = MagicMock(returncode=0, stderr="")
    with patch(
        "arete_agents.context_map.repo_cache.subprocess.run", return_value=fake_result
    ) as run:
        repo_dir = ensure_repo_checked_out(
            clone_url="https://github.com/acme/api.git",
            installation_token="ghs_abc123",
            installation_id=42,
            repo_slug="acme/api",
            root=root,
        )
    assert repo_dir == root / "42" / "acme__api"
    args = run.call_args[0][0]
    assert args[:2] == ["git", "clone"]
    assert "x-access-token:ghs_abc123@github.com" in args[-2]


def test_ensure_repo_checked_out_pulls_when_already_cloned(tmp_path):
    root = tmp_path / "repos"
    repo_dir = root / "42" / "acme__api"
    (repo_dir / ".git").mkdir(parents=True)
    fake_result = MagicMock(returncode=0, stderr="")
    with patch(
        "arete_agents.context_map.repo_cache.subprocess.run", return_value=fake_result
    ) as run:
        ensure_repo_checked_out(
            clone_url="https://github.com/acme/api.git",
            installation_token="ghs_abc123",
            installation_id=42,
            repo_slug="acme/api",
            root=root,
        )
    args = run.call_args[0][0]
    assert args[:4] == ["git", "-C", str(repo_dir), "pull"]


def test_ensure_repo_checked_out_raises_and_redacts_token_on_git_failure(tmp_path):
    root = tmp_path / "repos"
    fake_result = MagicMock(
        returncode=128,
        stderr="fatal: could not read from 'https://x-access-token:ghs_abc123@github.com/acme/api.git'",
    )
    with patch(
        "arete_agents.context_map.repo_cache.subprocess.run", return_value=fake_result
    ):
        with pytest.raises(RepoCacheError) as exc_info:
            ensure_repo_checked_out(
                clone_url="https://github.com/acme/api.git",
                installation_token="ghs_abc123",
                installation_id=42,
                repo_slug="acme/api",
                root=root,
            )
    assert "ghs_abc123" not in str(exc_info.value)
    assert "x-access-token:***@" in str(exc_info.value)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && uv run pytest tests/test_repo_cache.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'arete_agents.context_map.repo_cache'`

- [ ] **Step 3: Implement repo_cache.py**

Create `packages/agents/src/arete_agents/context_map/repo_cache.py`:

```python
import re
import subprocess
from pathlib import Path

DEFAULT_REPOS_ROOT = Path("/app/.data/repos")

_TOKEN_REDACT_PATTERN = re.compile(r"x-access-token:[^@]+@")


class RepoCacheError(Exception):
    """Raised when a clone or pull fails, or the clone URL isn't a scheme
    we know how to inject a token into. Callers must catch this and fail
    open (skip context-mapping for this review) rather than let it
    propagate into the review pipeline."""


def _repo_dir(root: Path, installation_id: int, repo_slug: str) -> Path:
    safe_slug = repo_slug.replace("/", "__")
    return root / str(installation_id) / safe_slug


def _with_token(clone_url: str, token: str) -> str:
    """Inject the installation token as the HTTPS Basic-auth username, per
    GitHub App conventions (https://x-access-token:<token>@github.com/...).
    The result is only ever passed as a subprocess argument — never
    logged."""
    if not clone_url.startswith("https://"):
        raise RepoCacheError(f"Unsupported clone URL scheme: {clone_url!r}")
    return clone_url.replace("https://", f"https://x-access-token:{token}@", 1)


def _redact(text: str) -> str:
    """Strip any embedded token from git's stderr before it's ever raised
    or logged — git includes the full remote URL (with credentials) in
    some of its error messages."""
    return _TOKEN_REDACT_PATTERN.sub("x-access-token:***@", text)


def ensure_repo_checked_out(
    clone_url: str,
    installation_token: str,
    installation_id: int,
    repo_slug: str,
    root: Path = DEFAULT_REPOS_ROOT,
) -> Path:
    """Clone the repo on first use, or fast-forward pull on subsequent
    calls. Returns the local checkout directory. Raises RepoCacheError on
    any git failure — never returns a partially-checked-out directory
    silently."""
    repo_dir = _repo_dir(root, installation_id, repo_slug)
    authed_url = _with_token(clone_url, installation_token)

    if (repo_dir / ".git").exists():
        command = ["git", "-C", str(repo_dir), "pull", "--ff-only", authed_url]
    else:
        repo_dir.parent.mkdir(parents=True, exist_ok=True)
        command = ["git", "clone", "--depth", "1", authed_url, str(repo_dir)]

    result = subprocess.run(command, capture_output=True, text=True, timeout=120)

    if result.returncode != 0:
        raise RepoCacheError(
            f"git operation failed for {repo_slug}: {_redact(result.stderr)}"
        )
    return repo_dir
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && uv run pytest tests/test_repo_cache.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/context_map/__init__.py \
  packages/agents/src/arete_agents/context_map/repo_cache.py \
  packages/agents/tests/test_repo_cache.py
git commit -m "feat(context-map): add per-installation repo clone-or-pull cache"
```

---

### Task 3: Stdio MCP session helpers + codebase-memory-mcp indexer

**Files:**
- Modify: `packages/agents/src/arete_agents/mcp/client.py`
- Create: `packages/agents/tests/test_mcp_client.py`
- Create: `packages/agents/src/arete_agents/context_map/indexer.py`
- Create: `packages/agents/tests/test_indexer.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (this task is independent of Task 2, though `context_map/__init__.py` in Task 4 wires them together).
- Produces: `get_or_create_session(server_name: str, command: str) -> ClientSession` and `call_tool_sync(server_name: str, tool_name: str, arguments: dict, timeout: float = 60) -> Any` in `mcp/client.py`.
- Produces: `IndexerError(Exception)`, `index_repository(installation_id: int, repo_dir: Path) -> str` in `context_map/indexer.py`. Task 4 imports `IndexerError` and `index_repository` from this module.

- [ ] **Step 1: Write the failing tests for the new mcp/client.py helpers**

Create `packages/agents/tests/test_mcp_client.py`:

```python
import asyncio
from unittest.mock import MagicMock, patch

import pytest

from arete_agents.mcp import client as mcp_client


@pytest.fixture(autouse=True)
def reset_mcp_client_state():
    """The module under test keeps process-wide session state in globals.
    Reset it before and after every test so tests don't leak into each
    other (mirrors the fixture-per-test isolation used throughout this
    suite)."""
    mcp_client._sessions.clear()
    mcp_client._tool_definitions.clear()
    yield
    mcp_client._sessions.clear()
    mcp_client._tool_definitions.clear()


def test_get_or_create_session_reuses_existing_session():
    fake_session = MagicMock()
    mcp_client._sessions["already-connected"] = fake_session

    with patch.object(mcp_client, "_ensure_bg_loop") as ensure_loop, \
         patch("asyncio.run_coroutine_threadsafe") as run_coro:
        result = mcp_client.get_or_create_session("already-connected", "/usr/local/bin/codebase-memory-mcp")

    assert result is fake_session
    ensure_loop.assert_called_once()
    run_coro.assert_not_called()


def test_get_or_create_session_connects_when_not_present():
    fake_loop = MagicMock()
    fake_future = MagicMock()

    def fake_connect_stdio_effect(*_args, **_kwargs):
        mcp_client._sessions["new-server"] = MagicMock()

    with patch.object(mcp_client, "_ensure_bg_loop", return_value=fake_loop), \
         patch("asyncio.run_coroutine_threadsafe", return_value=fake_future) as run_coro:
        fake_future.result.side_effect = fake_connect_stdio_effect
        result = mcp_client.get_or_create_session("new-server", "/usr/local/bin/codebase-memory-mcp")

    run_coro.assert_called_once()
    assert result is mcp_client._sessions["new-server"]


def test_call_tool_sync_raises_when_no_session():
    with pytest.raises(RuntimeError, match="No MCP session"):
        mcp_client.call_tool_sync("missing-server", "index_repository", {})


def test_call_tool_sync_invokes_session_call_tool():
    fake_session = MagicMock()
    mcp_client._sessions["srv"] = fake_session
    fake_loop = MagicMock()
    mcp_client._bg_loop = fake_loop
    fake_future = MagicMock()
    fake_future.result.return_value = "tool-result"

    with patch("asyncio.run_coroutine_threadsafe", return_value=fake_future) as run_coro:
        result = mcp_client.call_tool_sync("srv", "index_repository", {"repo_path": "/tmp/x"})

    assert result == "tool-result"
    run_coro.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && uv run pytest tests/test_mcp_client.py -v`
Expected: FAIL — `AttributeError: module 'arete_agents.mcp.client' has no attribute 'get_or_create_session'`

- [ ] **Step 3: Add the two public helpers to mcp/client.py**

Append to the end of `packages/agents/src/arete_agents/mcp/client.py` (after the existing `get_mcp_tools_for_agent` function, i.e. after the current final line `return langchain_tools`):

```python


def get_or_create_session(server_name: str, command: str) -> "ClientSession":
    """Public entry point for callers that need a raw stdio MCP session
    directly (not a LangChain tool list) — e.g. context_map.indexer talking
    to a local codebase-memory-mcp binary that needs no auth/config file at
    all. Reuses the same background event loop and session cache as
    get_mcp_tools_for_agent so both code paths share one connection per
    server_name."""
    if not HAS_MCP:
        raise RuntimeError("The 'mcp' package is not installed.")

    loop = _ensure_bg_loop()
    if server_name not in _sessions:
        future = asyncio.run_coroutine_threadsafe(_connect_stdio(server_name, command), loop)
        future.result(timeout=15)
    return _sessions[server_name]


def call_tool_sync(server_name: str, tool_name: str, arguments: dict, timeout: float = 60) -> Any:
    """Synchronously call a tool on an already-connected stdio session
    (see get_or_create_session). Raises RuntimeError if server_name has no
    active session."""
    session = _sessions.get(server_name)
    if not session:
        raise RuntimeError(f"No MCP session for server '{server_name}'.")

    async def _call():
        return await session.call_tool(tool_name, arguments=arguments)

    future = asyncio.run_coroutine_threadsafe(_call(), _bg_loop)
    return future.result(timeout=timeout)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && uv run pytest tests/test_mcp_client.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Write the failing tests for indexer.py**

Create `packages/agents/tests/test_indexer.py`:

```python
from unittest.mock import MagicMock, patch

import pytest


def _tool_result(status: str | None):
    block = MagicMock()
    block.text = "not json" if status is None else f'{{"status": "{status}"}}'
    result = MagicMock()
    result.content = [block]
    return result


@patch(
    "arete_agents.context_map.indexer._resolve_binary",
    return_value="/usr/local/bin/codebase-memory-mcp",
)
@patch("arete_agents.context_map.indexer.mcp_client")
def test_index_repository_returns_project_name_on_success(mock_client, _mock_binary, tmp_path):
    from arete_agents.context_map.indexer import index_repository

    mock_client.call_tool_sync.return_value = _tool_result("indexed")

    project = index_repository(installation_id=42, repo_dir=tmp_path)

    assert project == "install-42"
    mock_client.get_or_create_session.assert_called_once_with(
        "context-map-42", "/usr/local/bin/codebase-memory-mcp"
    )


@patch(
    "arete_agents.context_map.indexer._resolve_binary",
    return_value="/usr/local/bin/codebase-memory-mcp",
)
@patch("arete_agents.context_map.indexer.mcp_client")
def test_index_repository_raises_on_degraded_status(mock_client, _mock_binary, tmp_path):
    from arete_agents.context_map.indexer import IndexerError, index_repository

    mock_client.call_tool_sync.return_value = _tool_result("degraded")

    with pytest.raises(IndexerError):
        index_repository(installation_id=42, repo_dir=tmp_path)


@patch(
    "arete_agents.context_map.indexer._resolve_binary",
    return_value="/usr/local/bin/codebase-memory-mcp",
)
@patch("arete_agents.context_map.indexer.mcp_client")
def test_index_repository_raises_when_session_call_fails(mock_client, _mock_binary, tmp_path):
    from arete_agents.context_map.indexer import IndexerError, index_repository

    mock_client.get_or_create_session.side_effect = RuntimeError("subprocess failed to start")

    with pytest.raises(IndexerError):
        index_repository(installation_id=42, repo_dir=tmp_path)


def test_index_repository_raises_when_binary_missing(tmp_path, monkeypatch):
    from arete_agents.context_map.indexer import IndexerError, index_repository

    monkeypatch.delenv("CBM_BINARY_PATH", raising=False)
    with patch("arete_agents.context_map.indexer.shutil.which", return_value=None):
        with pytest.raises(IndexerError):
            index_repository(installation_id=42, repo_dir=tmp_path)
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd packages/agents && uv run pytest tests/test_indexer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'arete_agents.context_map.indexer'`

- [ ] **Step 7: Implement indexer.py**

Create `packages/agents/src/arete_agents/context_map/indexer.py`:

```python
import json
import os
import shutil
from pathlib import Path
from typing import Any

from arete_agents.mcp import client as mcp_client

_BINARY_ENV_VAR = "CBM_BINARY_PATH"
_DEFAULT_BINARY_NAME = "codebase-memory-mcp"


class IndexerError(Exception):
    """Raised when the codebase-memory-mcp binary is missing, the MCP
    session can't be established, or indexing itself fails or reports a
    degraded result. Callers must catch this and fail open."""


def _resolve_binary() -> str:
    override = os.environ.get(_BINARY_ENV_VAR)
    if override:
        return override
    found = shutil.which(_DEFAULT_BINARY_NAME)
    if not found:
        raise IndexerError(
            f"{_DEFAULT_BINARY_NAME} binary not found on PATH and "
            f"{_BINARY_ENV_VAR} is not set."
        )
    return found


def _extract_status(result: Any) -> str | None:
    """codebase-memory-mcp's index_repository returns a CallToolResult
    whose content is a list of content blocks; the tool's JSON payload is
    the first block's text. Any parsing failure is treated as an unknown
    (non-degraded) status rather than raising — a status-parsing hiccup
    shouldn't fail an otherwise-successful index."""
    try:
        return json.loads(result.content[0].text).get("status")
    except Exception:
        return None


def index_repository(installation_id: int, repo_dir: Path) -> str:
    """Index (or incrementally re-index) repo_dir into codebase-memory-mcp's
    graph, keyed by a per-installation project name. Returns the project
    name callers should use for subsequent queries. Raises IndexerError on
    any failure — callers must catch this and fail open."""
    server_name = f"context-map-{installation_id}"
    project = f"install-{installation_id}"

    binary = _resolve_binary()
    try:
        mcp_client.get_or_create_session(server_name, binary)
        result = mcp_client.call_tool_sync(
            server_name,
            "index_repository",
            {"repo_path": str(repo_dir), "project": project},
        )
    except Exception as exc:
        raise IndexerError(f"Failed to index {repo_dir}: {exc}") from exc

    if _extract_status(result) == "degraded":
        raise IndexerError(f"Indexing degraded for {repo_dir} (project={project})")

    return project
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/agents && uv run pytest tests/test_indexer.py -v`
Expected: PASS (4 passed)

- [ ] **Step 9: Commit**

```bash
git add packages/agents/src/arete_agents/mcp/client.py packages/agents/tests/test_mcp_client.py \
  packages/agents/src/arete_agents/context_map/indexer.py packages/agents/tests/test_indexer.py
git commit -m "feat(context-map): add stdio MCP session helpers and codebase-memory-mcp indexer"
```

---

### Task 4: ensure_indexed — the fail-open orchestration entry point

**Files:**
- Modify: `packages/agents/src/arete_agents/context_map/__init__.py`
- Create: `packages/agents/tests/test_context_map.py`

**Interfaces:**
- Consumes: `RepoCacheError`, `ensure_repo_checked_out` from `context_map.repo_cache` (Task 2); `IndexerError`, `index_repository` from `context_map.indexer` (Task 3); `PRContext` from `arete_agents.models.pr`.
- Produces: `ensure_indexed(pr: PRContext) -> str | None`. Task 5 imports this directly: `from arete_agents.context_map import ensure_indexed`.

- [ ] **Step 1: Write the failing tests**

Create `packages/agents/tests/test_context_map.py`:

```python
from pathlib import Path
from unittest.mock import patch

from arete_agents.context_map import ensure_indexed
from arete_agents.context_map.indexer import IndexerError
from arete_agents.context_map.repo_cache import RepoCacheError
from arete_agents.models.pr import FileChange, PRContext


def _pr(**overrides):
    defaults = dict(
        repo="acme/api",
        pr_number=1,
        title="t",
        description="",
        files=[FileChange(path="a.py", patch="+x", additions=1, deletions=0)],
    )
    defaults.update(overrides)
    return PRContext(**defaults)


def test_ensure_indexed_returns_none_without_clone_fields():
    assert ensure_indexed(_pr()) is None


def test_ensure_indexed_returns_none_when_installation_id_missing():
    pr = _pr(clone_url="https://github.com/acme/api.git", installation_token="ghs_x")
    assert ensure_indexed(pr) is None


@patch("arete_agents.context_map.index_repository", return_value="install-42")
@patch("arete_agents.context_map.ensure_repo_checked_out", return_value=Path("/tmp/repo"))
def test_ensure_indexed_returns_project_on_success(mock_checkout, mock_index):
    pr = _pr(
        clone_url="https://github.com/acme/api.git",
        installation_token="ghs_x",
        installation_id=42,
    )

    project = ensure_indexed(pr)

    assert project == "install-42"
    mock_checkout.assert_called_once_with(
        clone_url="https://github.com/acme/api.git",
        installation_token="ghs_x",
        installation_id=42,
        repo_slug="acme/api",
    )
    mock_index.assert_called_once_with(installation_id=42, repo_dir=Path("/tmp/repo"))


@patch(
    "arete_agents.context_map.ensure_repo_checked_out",
    side_effect=RepoCacheError("clone failed"),
)
def test_ensure_indexed_fails_open_on_clone_error(_mock_checkout):
    pr = _pr(
        clone_url="https://github.com/acme/api.git",
        installation_token="ghs_x",
        installation_id=42,
    )
    assert ensure_indexed(pr) is None


@patch("arete_agents.context_map.index_repository", side_effect=IndexerError("indexing failed"))
@patch("arete_agents.context_map.ensure_repo_checked_out", return_value=Path("/tmp/repo"))
def test_ensure_indexed_fails_open_on_index_error(_mock_checkout, _mock_index):
    pr = _pr(
        clone_url="https://github.com/acme/api.git",
        installation_token="ghs_x",
        installation_id=42,
    )
    assert ensure_indexed(pr) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && uv run pytest tests/test_context_map.py -v`
Expected: FAIL — `ImportError: cannot import name 'ensure_indexed' from 'arete_agents.context_map'`

- [ ] **Step 3: Implement ensure_indexed**

Replace the contents of `packages/agents/src/arete_agents/context_map/__init__.py` (currently empty) with:

```python
import logging

from arete_agents.context_map.indexer import IndexerError, index_repository
from arete_agents.context_map.repo_cache import RepoCacheError, ensure_repo_checked_out
from arete_agents.models.pr import PRContext

__all__ = ["ensure_indexed"]


def ensure_indexed(pr: PRContext) -> str | None:
    """Best-effort: clone/pull the PR's repo and index it via
    codebase-memory-mcp. Returns the project name to use for subsequent
    graph queries, or None if context-mapping could not run for this
    review — missing fields (CLI/eval/local callers), or any clone/index
    failure. A review must never fail because of this."""
    if not pr.clone_url or not pr.installation_token or pr.installation_id is None:
        return None

    try:
        repo_dir = ensure_repo_checked_out(
            clone_url=pr.clone_url,
            installation_token=pr.installation_token,
            installation_id=pr.installation_id,
            repo_slug=pr.repo,
        )
        return index_repository(installation_id=pr.installation_id, repo_dir=repo_dir)
    except (RepoCacheError, IndexerError) as exc:
        logging.warning(
            f"Context-mapping skipped for {pr.repo} (installation "
            f"{pr.installation_id}): {exc}"
        )
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && uv run pytest tests/test_context_map.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/context_map/__init__.py packages/agents/tests/test_context_map.py
git commit -m "feat(context-map): add ensure_indexed fail-open orchestration entry point"
```

---

### Task 5: Wire ensure_indexed into ReviewOrchestrator.run()

**Files:**
- Modify: `packages/agents/src/arete_agents/orchestrator.py`
- Modify: `packages/agents/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `ensure_indexed` from `arete_agents.context_map` (Task 4).
- Produces: no new public interface — `ReviewOrchestrator.run()`'s existing signature and return type (`ReviewResult`) are unchanged.

- [ ] **Step 1: Write the failing test**

Add to `packages/agents/tests/test_orchestrator.py` (append near the other `run()`-level tests; it uses the existing `cyclic_llm` and `sample_pr` fixtures from `conftest.py`):

```python
def test_run_completes_when_context_mapping_raises_unexpectedly(cyclic_llm, sample_pr):
    """ensure_indexed already fails open internally (Task 4), but this
    proves the invariant holds even if it raises something unexpected —
    context-mapping must never be able to fail a review."""
    from arete_agents.orchestrator import ReviewOrchestrator

    orch = ReviewOrchestrator(llm=cyclic_llm)
    with patch("arete_agents.orchestrator.ensure_indexed", side_effect=RuntimeError("boom")):
        result = orch.run(sample_pr)

    assert result is not None
    assert result.pr_context == sample_pr
```

Confirm `from unittest.mock import patch` is already imported at the top of `test_orchestrator.py` (it is, per the existing critic-stage tests in this file); if not, add it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agents && uv run pytest tests/test_orchestrator.py -k context_mapping_raises -v`
Expected: FAIL — `AttributeError: <module 'arete_agents.orchestrator'> does not have the attribute 'ensure_indexed'` (nothing to patch yet).

- [ ] **Step 3: Wire ensure_indexed into run()**

In `packages/agents/src/arete_agents/orchestrator.py`, add this import alongside the existing imports at the top of the file:

```python
from arete_agents.context_map import ensure_indexed
```

Change the start of `run()` from:

```python
    def run(self, pr: PRContext) -> ReviewResult:
        if not pr.files:
            return ReviewResult(
                pr_context=pr,
                file_reviews=[],
                overall_summary="No files changed.",
                risk_level="low",
            )
            
        try:
            state = self.graph.invoke({"pr": pr})
```

to:

```python
    def run(self, pr: PRContext) -> ReviewResult:
        if not pr.files:
            return ReviewResult(
                pr_context=pr,
                file_reviews=[],
                overall_summary="No files changed.",
                risk_level="low",
            )

        try:
            ensure_indexed(pr)
        except Exception as exc:
            # ensure_indexed already fails open internally on every known
            # failure mode (RepoCacheError, IndexerError). This is a second,
            # defensive layer so a genuinely unexpected bug in that path
            # still can't fail the review itself.
            logging.warning(
                f"Context-mapping raised unexpectedly: {exc}. Continuing without it."
            )

        try:
            state = self.graph.invoke({"pr": pr})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agents && uv run pytest tests/test_orchestrator.py -k context_mapping_raises -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -v`
Expected: all passing, 0 failed (every existing test's `PRContext` fixtures omit the new clone fields, so `ensure_indexed` returns `None` immediately for all of them — no behavior change to any existing test).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/orchestrator.py packages/agents/tests/test_orchestrator.py
git commit -m "feat(context-map): call ensure_indexed at the start of ReviewOrchestrator.run()"
```

---

### Task 6: Bake the codebase-memory-mcp binary into the agents Docker image

**Files:**
- Modify: `packages/agents/Dockerfile`

**Interfaces:**
- Consumes: nothing (infra-only task).
- Produces: `/usr/local/bin/codebase-memory-mcp` present and executable inside the `final` image stage, on `PATH` for the `arete` user; `/app/.data/repos` created and owned by `arete` (the clone-cache root `indexer.py`/`repo_cache.py` write to).

- [ ] **Step 1: Add a pinned, checksum-verified binary-fetch stage**

In `packages/agents/Dockerfile`, add a new build stage after the existing `builder` stage and before `final` stage:

```dockerfile
# --- codebase-memory-mcp: pinned, checksum-verified binary fetch ---
# Standard (non-UI) binary only — this is what indexer.py drives as an MCP
# stdio server during reviews. The UI-variant binary (context_map/ui.py)
# is fetched separately in the final stage below.
FROM base AS cbm-binary

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG CBM_VERSION=v0.9.0
ARG CBM_LINUX_AMD64_SHA256=e2832a8d207c26beaa30efa6222ed4a37cb3f526ca4bee060bfbf336ed6fc679

RUN curl -fsSL -o /tmp/cbm.tar.gz \
      "https://github.com/DeusData/codebase-memory-mcp/releases/download/${CBM_VERSION}/codebase-memory-mcp-linux-amd64.tar.gz" \
    && echo "${CBM_LINUX_AMD64_SHA256}  /tmp/cbm.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/cbm.tar.gz -C /tmp codebase-memory-mcp \
    && install -m 0755 /tmp/codebase-memory-mcp /usr/local/bin/codebase-memory-mcp \
    && rm -rf /tmp/cbm.tar.gz /tmp/codebase-memory-mcp
```

(`CBM_LINUX_AMD64_SHA256` above is the real published checksum for the `codebase-memory-mcp-linux-amd64.tar.gz` asset on the `v0.9.0` release, verified against `checksums.txt` on that release before writing this plan — not a placeholder.)

- [ ] **Step 2: Copy the binary into the final stage and prepare the cache directory**

In `packages/agents/Dockerfile`, in the existing `final` stage, add these lines after the existing `COPY --from=builder ...` lines and before `ENV PATH=...`:

```dockerfile
COPY --from=cbm-binary /usr/local/bin/codebase-memory-mcp /usr/local/bin/codebase-memory-mcp

# Warm cache for per-installation clones + codebase-memory-mcp indexes.
# Not a volume — see context-mapping-foundation-design.md's "Lightweight
# over full infra" constraint. Created (and owned by the non-root arete
# user) here, before USER arete below, since that user can't chown it
# itself.
RUN mkdir -p /app/.data/repos && chown -R arete:arete /app/.data
```

Confirm the final stage's order is: `groupadd`/`useradd` (already present near the top) → `WORKDIR /app` → the existing `COPY --from=builder` lines → the two new lines above → `ENV PATH=...` → `USER arete` → `EXPOSE`/`CMD`. The `chown` must run as root, i.e. before the existing `USER arete` line.

Add one environment variable alongside the existing `ENV PATH=... PYTHONUNBUFFERED=1` line so codebase-memory-mcp's own on-disk index cache lives under the same app-owned directory rather than `~/.cache` (which may not exist for the `arete` system user):

```dockerfile
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    CBM_CACHE_DIR=/app/.data/cbm-cache
```

(This replaces the existing single-line `ENV PATH=... PYTHONUNBUFFERED=1` — same two vars, plus the new third one.)

- [ ] **Step 3: Verify the image builds and the binary runs**

Run: `docker build -f packages/agents/Dockerfile -t arete-agents-context-map-test packages/agents`
Expected: build succeeds; the `sha256sum -c -` step in the `cbm-binary` stage fails the build loudly if GitHub ever serves different bytes for that pinned tag+asset (supply-chain integrity check, not just a download).

Run: `docker run --rm --entrypoint codebase-memory-mcp arete-agents-context-map-test --help`
Expected: the binary's help/usage output prints (proves it's present, executable, and not corrupted) rather than a "not found" or "exec format error".

- [ ] **Step 4: Commit**

```bash
git add packages/agents/Dockerfile
git commit -m "feat(context-map): bake pinned codebase-memory-mcp binary into agents image"
```

---

### Task 7: Lazily-started graph-UI backend endpoint

**Files:**
- Modify: `packages/agents/Dockerfile`
- Create: `packages/agents/src/arete_agents/context_map/ui.py`
- Create: `packages/agents/tests/test_context_map_ui.py`
- Modify: `packages/agents/src/arete_agents/server.py`

**Interfaces:**
- Consumes: `DEFAULT_REPOS_ROOT` from `context_map.repo_cache` (Task 2).
- Produces: `ContextMapUIError(Exception)`, `get_or_start_ui(installation_id: int, root: Path = DEFAULT_REPOS_ROOT) -> str` in `context_map/ui.py`. Produces the `GET /context-map/ui-url/{installation_id}` endpoint on the `agents` FastAPI app — this is what a future dashboard task (out of scope here, see Global Constraints) will call to embed the graph viewer.

- [ ] **Step 1: Add the UI-variant binary fetch to the Dockerfile**

In `packages/agents/Dockerfile`, in the `cbm-binary` stage added in Task 6, add a second fetch after the existing `RUN curl ... install -m 0755 ...` block (same stage, so both binaries are fetched together):

```dockerfile
ARG CBM_UI_LINUX_AMD64_SHA256=c30901921ba02738e759d9a463bf205a2fe31fd8feed41fb84ed364f18015dea

RUN curl -fsSL -o /tmp/cbm-ui.tar.gz \
      "https://github.com/DeusData/codebase-memory-mcp/releases/download/${CBM_VERSION}/codebase-memory-mcp-ui-linux-amd64.tar.gz" \
    && echo "${CBM_UI_LINUX_AMD64_SHA256}  /tmp/cbm-ui.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/cbm-ui.tar.gz -C /tmp codebase-memory-mcp \
    && install -m 0755 /tmp/codebase-memory-mcp /usr/local/bin/codebase-memory-mcp-ui \
    && rm -rf /tmp/cbm-ui.tar.gz /tmp/codebase-memory-mcp
```

(`CBM_UI_LINUX_AMD64_SHA256` above is the real published checksum for the `codebase-memory-mcp-ui-linux-amd64.tar.gz` asset on the `v0.9.0` release, verified against `checksums.txt` on that release before writing this plan.)

Then in the `final` stage, add the copy line right after the existing `COPY --from=cbm-binary ... codebase-memory-mcp` line from Task 6:

```dockerfile
COPY --from=cbm-binary /usr/local/bin/codebase-memory-mcp-ui /usr/local/bin/codebase-memory-mcp-ui
```

- [ ] **Step 2: Write the failing tests for get_or_start_ui**

Create `packages/agents/tests/test_context_map_ui.py`:

```python
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def reset_ui_process_state():
    from arete_agents.context_map import ui

    ui._running_ui_processes.clear()
    yield
    ui._running_ui_processes.clear()


def test_get_or_start_ui_raises_when_no_index_exists(tmp_path):
    from arete_agents.context_map.ui import ContextMapUIError, get_or_start_ui

    with pytest.raises(ContextMapUIError):
        get_or_start_ui(installation_id=42, root=tmp_path)


def test_get_or_start_ui_raises_when_binary_missing(tmp_path):
    from arete_agents.context_map.ui import ContextMapUIError, get_or_start_ui

    indexed_repo = tmp_path / "42" / "acme__api" / ".git"
    indexed_repo.mkdir(parents=True)

    with patch("arete_agents.context_map.ui.shutil.which", return_value=None):
        with pytest.raises(ContextMapUIError):
            get_or_start_ui(installation_id=42, root=tmp_path)


def test_get_or_start_ui_starts_process_and_returns_url(tmp_path):
    from arete_agents.context_map.ui import get_or_start_ui

    indexed_repo = tmp_path / "42" / "acme__api" / ".git"
    indexed_repo.mkdir(parents=True)

    fake_proc = MagicMock()
    fake_proc.poll.return_value = None

    with patch("arete_agents.context_map.ui.shutil.which", return_value="/usr/local/bin/codebase-memory-mcp-ui"), \
         patch("arete_agents.context_map.ui.subprocess.Popen", return_value=fake_proc) as popen, \
         patch("arete_agents.context_map.ui._find_free_port", return_value=54321):
        url = get_or_start_ui(installation_id=42, root=tmp_path)

    assert url == "http://127.0.0.1:54321"
    popen.assert_called_once()


def test_get_or_start_ui_reuses_running_process(tmp_path):
    from arete_agents.context_map import ui
    from arete_agents.context_map.ui import get_or_start_ui

    indexed_repo = tmp_path / "42" / "acme__api" / ".git"
    indexed_repo.mkdir(parents=True)

    fake_proc = MagicMock()
    fake_proc.poll.return_value = None
    ui._running_ui_processes[42] = (fake_proc, 54321)

    with patch("arete_agents.context_map.ui.subprocess.Popen") as popen:
        url = get_or_start_ui(installation_id=42, root=tmp_path)

    assert url == "http://127.0.0.1:54321"
    popen.assert_not_called()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/agents && uv run pytest tests/test_context_map_ui.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'arete_agents.context_map.ui'`

- [ ] **Step 4: Implement ui.py**

Create `packages/agents/src/arete_agents/context_map/ui.py`:

```python
import os
import shutil
import socket
import subprocess
from pathlib import Path

from arete_agents.context_map.repo_cache import DEFAULT_REPOS_ROOT

_UI_BINARY_ENV_VAR = "CBM_UI_BINARY_PATH"
_DEFAULT_UI_BINARY_NAME = "codebase-memory-mcp-ui"

# installation_id -> (Popen handle, port). Process-wide, mirrors the
# session-caching pattern in mcp/client.py's _sessions dict — one running
# UI subprocess per installation, started lazily on first request.
_running_ui_processes: dict[int, tuple[subprocess.Popen, int]] = {}


class ContextMapUIError(Exception):
    """Raised when no index exists yet for this installation, or the
    UI-variant binary can't be found/started."""


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _has_indexed_repo(installation_id: int, root: Path) -> bool:
    return any((root / str(installation_id)).glob("*/.git"))


def get_or_start_ui(installation_id: int, root: Path = DEFAULT_REPOS_ROOT) -> str:
    """Return the base URL of a running codebase-memory-mcp graph-UI
    process for this installation, starting one if none is running yet.
    Raises ContextMapUIError if no repo has been indexed for this
    installation, or the UI binary is unavailable — callers (the
    /context-map/ui-url endpoint) turn that into an honest "not available
    yet" response rather than a fabricated URL."""
    if installation_id in _running_ui_processes:
        proc, port = _running_ui_processes[installation_id]
        if proc.poll() is None:
            return f"http://127.0.0.1:{port}"
        del _running_ui_processes[installation_id]

    if not _has_indexed_repo(installation_id, root):
        raise ContextMapUIError(
            f"No indexed repository yet for installation {installation_id}."
        )

    binary = os.environ.get(_UI_BINARY_ENV_VAR) or shutil.which(_DEFAULT_UI_BINARY_NAME)
    if not binary:
        raise ContextMapUIError(
            f"{_DEFAULT_UI_BINARY_NAME} binary not found on PATH and "
            f"{_UI_BINARY_ENV_VAR} is not set."
        )

    port = _find_free_port()
    proc = subprocess.Popen(
        [binary, "--ui=true", f"--port={port}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _running_ui_processes[installation_id] = (proc, port)
    return f"http://127.0.0.1:{port}"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/agents && uv run pytest tests/test_context_map_ui.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: Add the endpoint to server.py**

In `packages/agents/src/arete_agents/server.py`, add this import alongside the existing imports:

```python
from arete_agents.context_map.ui import ContextMapUIError, get_or_start_ui
```

Add this endpoint after the existing `/chat` endpoint (end of file):

```python
@app.get("/context-map/ui-url/{installation_id}")
def context_map_ui_url(installation_id: int):
    try:
        url = get_or_start_ui(installation_id)
        return {"available": True, "url": url}
    except ContextMapUIError as exc:
        return {"available": False, "url": None, "reason": str(exc)}
```

This follows the same untested-route-wiring convention already established by the existing `/review` and `/chat` endpoints in this file (both call into independently-tested logic — `ReviewOrchestrator.run`, `ChatAgent.reply` — without a dedicated route-level test); `get_or_start_ui` is what Step 6 already covers. `server.py` cannot be imported directly in this test suite without a real `ANTHROPIC_API_KEY` (its module-level singletons fail fast on invalid config by design), which is why none of its routes have route-level tests today.

- [ ] **Step 7: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -v`
Expected: all passing, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add packages/agents/Dockerfile packages/agents/src/arete_agents/context_map/ui.py \
  packages/agents/tests/test_context_map_ui.py packages/agents/src/arete_agents/server.py
git commit -m "feat(context-map): add lazily-started graph-UI backend endpoint"
```

---

## Follow-Up (explicitly not part of this plan)

- **Dashboard iframe route** for `/context-map/ui-url/{installationId}` — deferred per Global Constraints; hand off to whoever next works in `packages/dashboard` once its current merge activity (Marble & Ink, dashboards-service) settles.
- **Sub-project B — Agentic Evidence-Gathering for Opus-Tier Agents**: the tool-calling loop that lets Security/Business Logic/Deployment Safety actually query the index this plan builds. Separate spec + plan, depends entirely on this one.
- Real end-to-end verification against a live GitHub App installation and the actual `codebase-memory-mcp` binary (this plan's automated tests fake both boundaries by design — see Global Constraints).
