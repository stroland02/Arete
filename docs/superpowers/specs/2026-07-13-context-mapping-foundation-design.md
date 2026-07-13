# Context-Mapping Foundation — Design Spec

**Date:** 2026-07-13
**Branch:** `main` (docs lane; implementation will branch off this spec)
**Package lanes touched:** `agents` (primary), `webhook` (small, additive), `infra` (Dockerfile)

## Goal

Give Areté's review pipeline access to the *rest of the repository*, not just
the PR diff, via a real code-graph index — and do it by adopting an existing,
mature open-source tool rather than building tree-sitter/AST indexing
ourselves. This is the foundation sub-project; a follow-up spec
("Agentic Evidence-Gathering for Opus-Tier Agents") builds the tool-calling
loop that actually *uses* what this spec makes available.

This spec covers infrastructure only: getting a repo onto disk, indexing it,
exposing the index as MCP tools, and giving it a visual surface. No review
agent's behavior changes as a result of this spec landing.

## Why adopt, not build

[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
(MIT license) is a single static binary, zero runtime dependencies, that
indexes a codebase into a persistent knowledge graph via vendored
tree-sitter grammars (158 languages) and answers structural queries
(`search_graph`, `trace_path`, `detect_changes`, `get_architecture`,
`search_code`, `get_code_snippet`, `semantic_query`, and more — 14 tools
total) in under a millisecond once indexed. It also ships a built-in 3D
graph-visualization UI. Building an equivalent ourselves — even a scoped-down
version — would mean owning tree-sitter grammar maintenance, incremental
indexing, and query planning for however many languages Areté's customers'
repos use. Areté already has a generic MCP tool-consumption layer
(`arete_agents/mcp/client.py`); this spec's job is almost entirely "plumb an
existing binary in," not "build a new subsystem."

## Global Constraints

- **Anti-fabrication (house standard):** the dashboard's graph-UI link/iframe
  must never imply live/real-time indexing when the index is actually stale
  (e.g. clone failed, indexing errored) — surface the last-indexed timestamp
  honestly, and an honest empty/error state when no index exists yet for an
  installation.
- **Lightweight over full infra:** no new persistent volume / stateful
  storage tier for v1. The per-installation clone lives on the `agents`
  container's local disk as a **warm cache for that container's lifetime**,
  not a durability guarantee. A restart/redeploy simply means the next
  review re-clones. If cold-start latency becomes a real problem later, a
  persistent volume is a follow-up decision, not a v1 requirement.
- **Tenant isolation:** clones are keyed per GitHub `installationId`, never
  shared across installations. The installation access token used to clone
  is short-lived (GitHub App installation tokens expire in ~1 hour) and is
  never persisted to disk or logs.
- **No new interactive/OAuth machinery:** `codebase-memory-mcp` needs no
  auth of its own (it's a local, zero-config binary). It must NOT be routed
  through `MCPManager`/`auth.py` (`agents/mcp/manager.py`,
  `agents/mcp/auth.py`), which are built for interactive, OAuth-style
  third-party servers — `MCPManager.add_server` calls Python's `input()` on
  a name collision, which would hang a FastAPI request. This is a
  pre-existing gap in that module, not something this spec fixes; we simply
  don't route through it.
- **Testing convention:** match the existing fake-client TDD pattern (see
  `tests/test_critic.py`, `tests/test_orchestrator.py`) — no real network
  calls, no real GitHub token, no requirement that the actual
  `codebase-memory-mcp` binary be present in CI. One narrow integration
  test may exercise the real binary, gated behind an env flag
  (`CBM_INTEGRATION_TEST=1`), skipped by default.

## Architecture

```
webhook (packages/webhook)
  worker.ts: processGitHubPullRequest()
    already has: octokit, installationId, owner, repo, fullName
    NEW: mint a short-lived installation access token via the App's
    auth strategy (app.octokit.auth({type: "installation", installationId}))
    NEW: attach { cloneUrl, installationToken } to PRContext before
    calling runReviewPipeline(prContext)

agents (packages/agents)
  models/pr.py: PRContext gains two optional fields
    clone_url: str | None = Field(None, alias="cloneUrl")
    installation_token: str | None = Field(None, alias="installationToken")
    (optional because: CLI/local/eval callers won't have them — context
    mapping is best-effort, reviews must still work without it)

  NEW arete_agents/context_map/
    repo_cache.py    — clone-or-pull into /app/.data/repos/<installationId>/<repo-slug>,
                        using installation_token as the HTTPS credential,
                        never logged, discarded from memory after the
                        subprocess call returns
    indexer.py        — spawns/reuses a codebase-memory-mcp subprocess
                         (stdio transport) per repo-cache directory as its
                         `project`; calls index_repository after each pull
    tools.py           — wraps indexer.py's session into LangChain tools via
                          the existing _create_langchain_tool bridge in
                          mcp/client.py (reused directly, not re-implemented)

  orchestrator.py
    NEW: before agent execution, ReviewOrchestrator calls
    context_map.ensure_indexed(pr) — best-effort: on any failure (no
    clone_url present, git failure, indexing failure, binary missing),
    logs a warning and continues with NO context-map tools available for
    this review. A context-mapping outage must never fail a review.

infra
  Dockerfile: RUN a pinned-version install of codebase-memory-mcp's
  standard (non-UI) binary into the image, same cached-layer pattern as
  the uv sync step. The `ui` binary variant runs as a separate, small
  sidecar/second entrypoint (see Visual below) — kept out of the main
  review-serving container so a UI crash/hang can't affect review latency.
```

## Data Flow

1. Webhook receives a PR event, resolves `octokit` + `installationId` as
   today.
2. **New step:** webhook mints a short-lived installation token from the
   same `App` instance already used for `getInstallationOctokit`, and
   builds `cloneUrl` from the repo's `full_name` (standard
   `https://github.com/{owner}/{repo}.git` form — GitHub accepts the
   installation token as the HTTP Basic username with the clone URL
   unmodified).
3. `runReviewPipeline(prContext)` POSTs the now-larger `PRContext` to
   `agents`'s `/review` endpoint, unchanged otherwise.
4. `ReviewOrchestrator.run()` calls `context_map.ensure_indexed(pr)` first.
   If `clone_url`/`installation_token` are present: clone-or-pull, then
   index. If anything fails or the fields are absent: skip silently (warn
   in logs only), proceed to agent execution with no context-map tools.
5. Agent execution proceeds as today for this spec (Sub-project B is what
   actually gives agents access to the resulting tools).
6. The dashboard's graph-UI link (see Visual) reads the same per-
   installation index for interactive browsing outside the review flow.

## Visual

The `ui` binary variant of `codebase-memory-mcp` runs as its own small
process (`codebase-memory-mcp --ui=true --port=9749`), one per active
installation directory, started lazily on demand rather than proactively for
every installation. The `agents` service owns this: it exposes
`GET /context-map/ui-url/{installationId}` which starts (or reuses, if
already running) the UI subprocess against that installation's indexed
directory on a free local port, and returns that URL. The dashboard route
calls this endpoint server-side (same tenancy-scoping check as every other
dashboard query — the caller's authorized installations only) and iframes
the returned URL, captioned with the last-indexed timestamp
(anti-fabrication: never implied to be "live"). If no
index exists yet for the installation (context-mapping hasn't run for any
PR yet, or has only ever failed), the dashboard shows an honest empty state
explaining that the graph appears after the first successfully-indexed
review — never a fabricated placeholder graph.

## Error Handling

- **No `clone_url`/`installation_token` on `PRContext`** (CLI, eval harness,
  older webhook version mid-rollout): context-mapping is skipped entirely,
  review proceeds as today. This is the default path for every existing
  test and eval fixture — none of them need updating.
- **Clone/pull fails** (network, token expired, repo deleted): logged as a
  warning, review proceeds without context-map tools. Matches the
  fail-open pattern already established for critic-stage LLM failures
  (`CriticAgent.critique`).
- **`codebase-memory-mcp` binary missing or subprocess fails to start**:
  same fail-open path. Detected once per `agents` process (attempt to
  locate the binary at startup, log a clear one-time warning if absent —
  mirrors the existing `HAS_MCP` guard in `mcp/client.py`).
- **Indexing itself fails** (`index_repository` returns an error/degraded
  status per the tool's own `status:"degraded"` signal): treated the same
  as a missing index — no tools exposed for this review.

## Testing

- `tests/test_repo_cache.py` — clone-or-pull logic against a local fixture
  git repo (created via `git init` in a pytest tmp_path fixture, no
  network), covering: fresh clone, incremental pull, and a simulated
  auth-failure path (bad remote URL) exercising the fail-open branch.
- `tests/test_context_map.py` — `context_map.ensure_indexed` against a
  fake indexer client (`MagicMock`, mirroring the `cyclic_llm`-style faking
  used elsewhere), covering: happy path, missing PRContext fields, indexer
  subprocess failure, degraded-status response.
- `tests/test_orchestrator.py` — new test confirming `ReviewOrchestrator.run()`
  completes normally (existing assertions unchanged) when
  `context_map.ensure_indexed` raises, proving the fail-open contract at
  the integration point.
- One `tests/test_context_map_integration.py`, skipped unless
  `CBM_INTEGRATION_TEST=1`, that runs the real binary against a tiny fixture
  repo checked into the test tree — for a human to run locally when
  verifying an actual binary upgrade.

## Out of Scope (deferred to later specs/decisions)

- Agents actually calling these tools mid-review (Sub-project B).
- Persistent volumes / surviving container restarts.
- Proactively indexing on webhook `push` events ahead of a PR being opened.
- Any UI beyond the read-only graph link (no in-dashboard query builder).
- Cross-repo intelligence (`CROSS_*` edges) — single-repo indexing only.
