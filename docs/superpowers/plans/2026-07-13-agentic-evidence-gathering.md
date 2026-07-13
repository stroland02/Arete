# Agentic Evidence-Gathering for Opus-Tier Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 3 opus-tier review agents (Security, Business Logic, Deployment Safety) a curated set of codebase-graph query tools, backed by the already-shipped Context-Mapping Foundation, so they can look beyond the PR diff during a review.

**Architecture:** One new function, `get_context_map_tools(agent_name, pr, root)`, that returns an empty list unless the agent is one of the 3 opus-tier names, the PR has an `installation_id`, and an index already exists on disk for that installation — in which case it connects to the already-running `codebase-memory-mcp` MCP session (reusing existing Context-Mapping Foundation plumbing), filters its tools to 4 curated names, and wraps them with a token-efficiency usage note. One line in `review_file()` extends this into the tool list the existing (already-built, unmodified) tool-calling loop already binds and executes.

**Tech Stack:** Python 3.12, `arete_agents` (pytest), reuses `langchain_core.tools`, `arete_agents.mcp.client`, `arete_agents.context_map.repo_cache`/`indexer` — all already shipped.

## Global Constraints

- **Agent scope:** only `security`, `business_logic`, `deployment_safety` (the exact snake_case strings each agent class's `agent_name` property returns) get context-map tools. No other agent, ever, in this plan.
- **Tool scope:** exactly 4 tools — `search_graph`, `trace_path`, `search_code`, `get_code_snippet`. Nothing else from codebase-memory-mcp's other 10 tools.
- **Fail-open, always:** `get_context_map_tools` must never raise. Every failure path (no index yet, session connect fails) returns `[]`.
- **No orchestrator/LangGraph changes:** `pr_context` is already a parameter of `review_file()` — no new field on `GraphState`/`ReviewTaskState`, no threading anything through `Send`.
- **Token-efficiency guidance:** every returned tool's `.description` must be prepended with the usage note specified in Task 1, Step 3 below — exact wording, not paraphrased.
- **Testing convention:** fake the boundary (`mcp_client` functions), no real `codebase-memory-mcp` binary or subprocess in the default test run — matches every existing test in `packages/agents/tests/test_context_map*.py`.
- **Package lane:** `packages/agents` only. No dashboard changes in this plan (that's a separate, already-deferred sub-project).

---

### Task 1: `context_map/tools.py` — get_context_map_tools

**Files:**
- Create: `packages/agents/src/arete_agents/context_map/tools.py`
- Create: `packages/agents/tests/test_context_map_tools.py`

**Interfaces:**
- Consumes: `DEFAULT_REPOS_ROOT` from `arete_agents.context_map.repo_cache`; `_has_indexed_repo` pattern from `arete_agents.context_map.ui` (reimplemented locally, not imported, to avoid a cross-import between sibling modules for a two-line helper — see Step 3); `arete_agents.context_map.indexer._resolve_binary`; `arete_agents.mcp.client.get_or_create_session`, `arete_agents.mcp.client._tool_definitions`, `arete_agents.mcp.client._create_langchain_tool`.
- Produces: `get_context_map_tools(agent_name: str, pr: PRContext, root: Path = DEFAULT_REPOS_ROOT) -> list`. Task 2 imports this directly.

- [ ] **Step 1: Write the failing tests**

Create `packages/agents/tests/test_context_map_tools.py`:

```python
from unittest.mock import MagicMock, patch

import pytest

from arete_agents.context_map.tools import get_context_map_tools
from arete_agents.models.pr import FileChange, PRContext


def _pr(**overrides):
    defaults = dict(
        repo="acme/api",
        pr_number=1,
        title="t",
        description="",
        files=[FileChange(path="a.py", patch="+x", additions=1, deletions=0)],
        installation_id=42,
    )
    defaults.update(overrides)
    return PRContext(**defaults)


def _fake_tool_def(name: str, description: str = "does a thing"):
    d = MagicMock()
    d.name = name
    d.description = description
    return d


def test_returns_empty_for_non_opus_tier_agent():
    with patch("arete_agents.context_map.tools.mcp_client") as mock_client:
        result = get_context_map_tools("performance", _pr())
    assert result == []
    mock_client.get_or_create_session.assert_not_called()


def test_returns_empty_when_installation_id_missing():
    with patch("arete_agents.context_map.tools.mcp_client") as mock_client:
        result = get_context_map_tools("security", _pr(installation_id=None))
    assert result == []
    mock_client.get_or_create_session.assert_not_called()


def test_returns_empty_when_no_indexed_repo_on_disk(tmp_path):
    with patch("arete_agents.context_map.tools.mcp_client") as mock_client:
        result = get_context_map_tools("security", _pr(), root=tmp_path)
    assert result == []
    mock_client.get_or_create_session.assert_not_called()


def test_returns_empty_when_session_connect_fails(tmp_path):
    indexed_repo = tmp_path / "42" / "acme__api" / ".git"
    indexed_repo.mkdir(parents=True)

    with patch("arete_agents.context_map.tools.mcp_client") as mock_client, \
         patch("arete_agents.context_map.tools._resolve_binary", return_value="/usr/local/bin/codebase-memory-mcp"):
        mock_client.get_or_create_session.side_effect = RuntimeError("subprocess failed")
        result = get_context_map_tools("security", _pr(), root=tmp_path)

    assert result == []


def test_returns_curated_tools_with_usage_note_on_success(tmp_path):
    indexed_repo = tmp_path / "42" / "acme__api" / ".git"
    indexed_repo.mkdir(parents=True)

    all_defs = [
        _fake_tool_def("search_graph", "Structured search by label/name pattern."),
        _fake_tool_def("trace_path", "BFS traversal of the call graph."),
        _fake_tool_def("search_code", "Grep-like text search."),
        _fake_tool_def("get_code_snippet", "Read source for a qualified name."),
        _fake_tool_def("index_repository", "Index a repository."),
        _fake_tool_def("delete_project", "Remove a project."),
    ]

    fake_wrapped = []
    for d in all_defs:
        wrapped = MagicMock()
        wrapped.name = d.name
        wrapped.description = d.description
        fake_wrapped.append(wrapped)

    def fake_create_langchain_tool(server_name, tool_def):
        return next(w for w in fake_wrapped if w.name == tool_def.name)

    with patch("arete_agents.context_map.tools.mcp_client") as mock_client, \
         patch("arete_agents.context_map.tools._resolve_binary", return_value="/usr/local/bin/codebase-memory-mcp"):
        mock_client._tool_definitions = {"context-map-42": all_defs}
        mock_client._create_langchain_tool.side_effect = fake_create_langchain_tool

        result = get_context_map_tools("security", _pr(), root=tmp_path)

    mock_client.get_or_create_session.assert_called_once_with(
        "context-map-42", "/usr/local/bin/codebase-memory-mcp"
    )
    result_names = {t.name for t in result}
    assert result_names == {"search_graph", "trace_path", "search_code", "get_code_snippet"}
    for t in result:
        assert t.description.startswith("Token-efficiency note:")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && uv run pytest tests/test_context_map_tools.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'arete_agents.context_map.tools'`

- [ ] **Step 3: Implement tools.py**

Create `packages/agents/src/arete_agents/context_map/tools.py`:

```python
import logging
from pathlib import Path

from arete_agents.context_map.indexer import _resolve_binary
from arete_agents.context_map.repo_cache import DEFAULT_REPOS_ROOT
from arete_agents.mcp import client as mcp_client
from arete_agents.models.pr import PRContext

_OPUS_TIER_AGENT_NAMES = {"security", "business_logic", "deployment_safety"}
_CURATED_TOOL_NAMES = {"search_graph", "trace_path", "search_code", "get_code_snippet"}

_USAGE_NOTE = (
    "Token-efficiency note: this is a structural graph query, not a raw "
    "file read — it costs a small fraction of the tokens a manual "
    "grep/read-file exploration would. Still, call it only when the diff "
    "and PR context genuinely aren't enough to judge the issue; don't "
    "call it reflexively on every file."
)


def _has_indexed_repo(installation_id: int, root: Path) -> bool:
    """Cheap local disk check — mirrors context_map/ui.py's helper of the
    same name (not imported from there to avoid a cross-import between
    sibling modules for a two-line check)."""
    return any((root / str(installation_id)).glob("*/.git"))


def get_context_map_tools(
    agent_name: str, pr: PRContext, root: Path = DEFAULT_REPOS_ROOT
) -> list:
    """Return the curated codebase-memory-mcp query tools for an
    opus-tier review agent, or an empty list if this agent shouldn't get
    them, no installation is known, no index exists yet, or anything about
    connecting to the index fails. Never raises — review_file() treats an
    empty tool list exactly like "no tools available today"."""
    if agent_name not in _OPUS_TIER_AGENT_NAMES:
        return []
    if pr.installation_id is None:
        return []
    if not _has_indexed_repo(pr.installation_id, root):
        return []

    server_name = f"context-map-{pr.installation_id}"
    try:
        binary = _resolve_binary()
        mcp_client.get_or_create_session(server_name, binary)
        tool_defs = mcp_client._tool_definitions.get(server_name, [])
        curated = [d for d in tool_defs if d.name in _CURATED_TOOL_NAMES]
        wrapped = [mcp_client._create_langchain_tool(server_name, d) for d in curated]
        for tool in wrapped:
            tool.description = f"{_USAGE_NOTE}\n\n{tool.description}"
        return wrapped
    except Exception as exc:
        logging.warning(
            f"Context-map tools unavailable for installation "
            f"{pr.installation_id}: {exc}"
        )
        return []
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && uv run pytest tests/test_context_map_tools.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q`
Expected: all passing (200 baseline + 5 new = 205 passed).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/context_map/tools.py packages/agents/tests/test_context_map_tools.py
git commit -m "feat(context-map): add curated codebase-graph tools for opus-tier agents"
```

---

### Task 2: Wire into review_file()

**Files:**
- Modify: `packages/agents/src/arete_agents/agents/base.py`
- Modify: `packages/agents/tests/test_agents.py`

**Interfaces:**
- Consumes: `get_context_map_tools(agent_name, pr, root)` from `context_map.tools` (Task 1).
- Produces: no new public interface — `review_file()`'s existing signature and return type (`FileReview`) are unchanged.

- [ ] **Step 1: Write the failing test**

Add to `packages/agents/tests/test_agents.py` (uses the file's existing `make_mock_llm`/`make_file` helpers):

```python
def test_review_file_never_gets_context_map_tools_for_non_opus_agent():
    """Regression guard: a non-opus-tier agent (Performance here) must
    never receive context-map tools, even with a real installation_id set.
    get_context_map_tools's agent-name check runs before its disk-index
    check, so this test doesn't need a real indexed repo on disk to be
    meaningful — Performance is gated out immediately regardless. Prevents
    a future accidental widening of the agent-name allowlist in
    get_context_map_tools from silently taking effect without a test
    catching it."""
    from arete_agents.agents.performance import PerformanceAgent
    from arete_agents.models.pr import PRContext

    pr = PRContext(
        repo="acme/api", pr_number=1, title="t", description="",
        files=[make_file()], installation_id=42,
    )

    mock_llm = make_mock_llm('{"comments": [], "summary": "ok"}')
    agent = PerformanceAgent(llm=mock_llm)

    agent.review_file(make_file(), pr)

    # bind_tools should have been called with a tool list never containing
    # a context-map tool name (native action tools may still be present).
    bound_tool_names = {
        t.name for call in mock_llm.bind_tools.call_args_list for t in call[0][0]
    }
    assert not bound_tool_names & {"search_graph", "trace_path", "search_code", "get_code_snippet"}
```

- [ ] **Step 2: Run test to verify it passes vacuously**

Run: `cd packages/agents && uv run pytest tests/test_agents.py -k never_gets_context_map -v`
Expected: this test PASSES even before Task 2's wiring change, since `get_context_map_tools` isn't called from `review_file()` yet — there's nothing to gate against. That's fine; it's a regression guard for after the wiring lands, not a red/green driver for this step. Confirm it runs without error (no import errors, no crash) before proceeding.

- [ ] **Step 3: Wire get_context_map_tools into review_file()**

In `packages/agents/src/arete_agents/agents/base.py`, find this block inside `review_file()`:

```python
        # Load authorized tools specifically for this agent type
        from arete_agents.mcp.client import get_mcp_tools_for_agent
        from arete_agents.tools.actions import get_native_action_tools
        mcp_tools = get_mcp_tools_for_agent(self.agent_name)
        mcp_tools.extend(get_native_action_tools())
```

Change it to:

```python
        # Load authorized tools specifically for this agent type
        from arete_agents.mcp.client import get_mcp_tools_for_agent
        from arete_agents.tools.actions import get_native_action_tools
        from arete_agents.context_map.tools import get_context_map_tools
        mcp_tools = get_mcp_tools_for_agent(self.agent_name)
        mcp_tools.extend(get_native_action_tools())
        mcp_tools.extend(get_context_map_tools(self.agent_name, pr_context))
```

- [ ] **Step 4: Run the new test to verify it passes for real**

Run: `cd packages/agents && uv run pytest tests/test_agents.py -k never_gets_context_map -v`
Expected: PASS (1 passed) — now genuinely exercising the wiring, not passing vacuously.

- [ ] **Step 5: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q`
Expected: all passing (205 baseline + 1 new = 206 passed).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/agents/base.py packages/agents/tests/test_agents.py
git commit -m "feat(context-map): wire get_context_map_tools into review_file()"
```
