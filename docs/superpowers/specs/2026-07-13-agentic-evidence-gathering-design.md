# Agentic Evidence-Gathering for Opus-Tier Agents — Design Spec

**Date:** 2026-07-13
**Branch:** `main` (docs lane; implementation will branch off this spec)
**Package lane touched:** `packages/agents` only

**Note on naming:** the product is being renamed from Areté to **Kuma**. This spec and all new docs going forward use Kuma; existing shipped code/docs are not being mass-renamed as part of this work.

## Goal

Give the 3 opus-tier review agents (Security, Business Logic, Deployment Safety) the ability to query the per-installation code-graph index built by the Context-Mapping Foundation (`codebase-memory-mcp`, wired in via `arete_agents/context_map/`), instead of seeing only the PR diff. This is Sub-project B of "deeper per-agent context" — Sub-project A (the index itself) is already shipped on `main`.

## Why this is a narrow addition, not a new subsystem

`review_file()` (`agents/base.py`) already has a generic, working, capped tool-calling loop: it loads tools via `get_mcp_tools_for_agent(self.agent_name)` (third-party MCP servers) plus `get_native_action_tools()` (propose_pr, ask_human), binds them to the LLM, and runs a `while` loop capped at `MAX_TOOL_ROUNDS = 5` executing whatever the model calls. This was built by an earlier, unrelated commit (`df414a6`) and needs no changes. This spec adds exactly one more tool source to that existing `mcp_tools` list, gated to 3 agent names, and one line in `review_file()` to extend it in.

## Architecture

```
context_map/tools.py (new)
  get_context_map_tools(agent_name: str, pr: PRContext,
                         root: Path = DEFAULT_REPOS_ROOT) -> list[BaseTool]

    1. agent_name not in {"security", "business_logic", "deployment_safety"}
       -> return []
    2. pr.installation_id is None -> return []
    3. no indexed repo directory on disk for this installation (cheap local
       glob check, mirrors context_map/ui.py's _has_indexed_repo — avoids
       spawning an MCP subprocess when there's nothing to query) -> return []
    4. otherwise: mcp_client.get_or_create_session(server_name, binary)
       (already built, Context-Mapping Foundation Task 3), read the tool
       definitions that connection already cached, filter to the 4
       curated names, wrap each via the existing mcp_client._create_langchain_tool
       bridge (same mechanism already used for third-party MCP servers),
       prepend a token-efficiency usage note to each tool's .description,
       return the wrapped list.
    Any exception anywhere in step 4 is caught and logged as a warning;
    the function returns [] rather than raising.

agents/base.py — review_file(), one new line:
    mcp_tools = get_mcp_tools_for_agent(self.agent_name)
    mcp_tools.extend(get_native_action_tools())
    mcp_tools.extend(get_context_map_tools(self.agent_name, pr_context))  # NEW
```

No changes to `orchestrator.py`, `GraphState`, or `ReviewTaskState` — `pr_context` is already a parameter of `review_file()`, so `pr.installation_id` is already available with zero new plumbing. No new failure mode is introduced at the orchestrator level: `get_context_map_tools` never raises, matching how `get_mcp_tools_for_agent` and `get_native_action_tools` already behave (neither raises today either).

## Tool Scope

Four tools, identical set for all 3 opus-tier agents (deliberately uniform rather than per-agent subsets — each agent's own system prompt already steers how it uses a general "explore the codebase" toolkit, and a uniform set is far simpler to build, test, and reason about than 3 tailored lists):

- `search_graph` — find symbols by name pattern/label
- `trace_path` — call-graph traversal (what calls this / what does this call)
- `search_code` — grep-like text search scoped to indexed files
- `get_code_snippet` — read a specific function/class's source by qualified name

Explicitly out of scope: `get_architecture`, `detect_changes`, `semantic_query`, and anything write/index-management-related (`index_repository`, `delete_project`, `manage_adr`, etc. — lifecycle operations `ensure_indexed` already owns exclusively).

## Token-Efficiency Guidance

Per the product's cost-sensitivity: each wrapped tool's `.description` (the text the LLM reads to decide whether/when to call it) gets a prepended usage note:

> "Token-efficiency note: this is a structural graph query, not a raw file read — it costs a small fraction of the tokens a manual grep/read-file exploration would. Still, call it only when the diff and PR context genuinely aren't enough to judge the issue; don't call it reflexively on every file."

This is a plain post-construction mutation of the wrapped `StructuredTool`'s `.description` field in `context_map/tools.py` — `mcp_client._create_langchain_tool` itself is not modified, keeping the blast radius on already-tested shared code at zero.

## Error Handling

Fail-open, matching the house standard already established by Context-Mapping Foundation:
- Any failure in `get_context_map_tools` (session connect fails, binary missing, no cached tool defs) returns `[]`. `review_file()` already treats an empty `mcp_tools` list as "no tools bound" — the review proceeds diff-only, identical to today's behavior.
- Any failure in an individual tool *call* (not load) is already handled by `review_file()`'s existing per-tool-call try/except (`except Exception as e: result = f"Error executing tool: {e}"`) — the LLM sees an error string and can proceed or retry within the existing 5-round cap. No changes needed there.

## Testing

Matches the fake-the-boundary pattern used throughout `packages/agents`:
- `tests/test_context_map_tools.py` — fakes `mcp_client.get_or_create_session`/`_tool_definitions`/`_create_langchain_tool` (or a fake tool-definition object with a `.name`), covering: non-opus-tier agent name returns `[]` without touching the filesystem or mcp_client at all; `installation_id=None` returns `[]`; no indexed repo on disk returns `[]` without attempting a session connect; a successful path returns exactly the 4 curated tools (not the other 10 codebase-memory-mcp exposes) with the usage note prepended to each description; a session-connect failure returns `[]`.
- `tests/test_agents.py` — one addition confirming a non-opus-tier agent (e.g. `PerformanceAgent`) never receives context-map tools even when a fully-indexed repo is present on disk for that installation (guards against a future accidental widening of the agent-name allowlist).
- No real `codebase-memory-mcp` binary or subprocess required for any of the above — same convention as Context-Mapping Foundation's own test suite.

## Out of Scope (deferred, tracked separately)

- Dashboard graph-UI integration into the Dashboards page (queued as its own sub-project, to be brainstormed next, in an isolated worktree given `feat/dashboards-service` is actively building that same page).
- Widening the tool set beyond the 4 curated tools, or extending access to the 3 sonnet-tier agents — no evidence yet that either is needed.
- Any change to `MAX_TOOL_ROUNDS` or the shared tool-execution loop itself.
