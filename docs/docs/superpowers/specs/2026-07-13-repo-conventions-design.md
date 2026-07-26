# Repo Conventions (AGENTS.md/CONVENTIONS.md) — Design Spec

**Date:** 2026-07-13
**Branch:** `main` (docs lane; implementation will branch off this spec)
**Package lanes touched:** `packages/webhook` (fetch), `packages/agents` (prompt injection)
**Master plan:** SP3a of the Kuma competitor-research master plan (see memory `project-arete-context-mapping-cmp`) — the smaller, self-contained half of SP3 ("Review Memory + Repo's Own AGENTS.md"). SP3b (cross-PR review memory persistence) is a separate, later brainstorm.

## Goal

Fetch the target repository's own `AGENTS.md` (falling back to `CONVENTIONS.md`) from the PR's base branch, and inject its content into every review agent's prompt as authoritative, repo-specific project conventions — the same mechanism competitors like Devin/Cognition-style agents already use to respect a project's own house rules rather than applying generic advice.

## Why this is a small, low-risk addition

The webhook already fetches and injects a repo-authored config file into every review: `.arete.yml`/`.arete.yaml` (custom rules + telemetry connectors), via `fetchAreteYaml` in `pr-fetcher.ts`. This spec adds a second, structurally identical fetch for a markdown file instead of YAML, following the exact same try-primary-then-fallback-then-null pattern, fetched from the same trusted ref (`pr.base.sha`, never the PR head — a PR must not be able to edit its own conventions doc to weaken the scrutiny applied to itself). On the agents side, `agents/base.py` already has precedent for exactly this kind of prompt injection (`project_memories`, `predecessor_handoff_notes`/`predecessor_root_cause` blocks) — this adds one more block using the same pattern.

## Architecture

```
packages/webhook/src/pr-fetcher.ts (modify)
  fetchAgentsDoc(octokit, owner, repo, ref): Promise<string | null>
    Mirrors fetchAreteYaml's tryFetch closure exactly: try "AGENTS.md" at
    the repo root, then "CONVENTIONS.md", return the decoded file content
    as a plain string (no YAML parsing — this is markdown/plain text,
    read verbatim). 404 on both -> null. Any other error -> logged,
    treated as null (fail-open, matching fetchAreteYaml's existing
    error handling for non-404 errors).

  fetchPRContext (modify)
    Adds one more call: const repoConventions = await
    fetchAgentsDoc(octokit, owner, repo, pr.base.sha) — same base-sha
    fetch as fetchAreteYaml, same trust rationale, called in parallel
    with it (Promise.all) rather than sequentially, since they're
    independent fetches.
    Adds repoConventions to the returned PRContext object, capped at a
    fixed character limit (matching the existing MAX_PATCH_CHARS pattern
    for diffs) so a very large AGENTS.md can't blow up every agent's
    prompt size.

packages/webhook/src/types.ts (modify)
  PRContext gains: repoConventions?: string

packages/agents/src/arete_agents/models/pr.py (modify)
  PRContext gains: repo_conventions: str | None = Field(None, alias="repoConventions")

packages/agents/src/arete_agents/agents/base.py (modify)
  _build_user_prompt (or wherever the existing project_memories/
  predecessor blocks are assembled) gains one more conditional block:
  if pr_context.repo_conventions is present, inject a
  "<repo_conventions>...</repo_conventions>" block (escaped via the
  existing escape_for_prompt helper, matching how other free-text
  PRContext fields are already handled) telling the agent to treat it as
  authoritative project-specific guidance.
```

## Data Flow

1. Webhook receives a PR event, resolves `octokit`/`owner`/`repo`/`prNumber` as today.
2. `fetchPRContext` now fetches `.arete.yml` and `AGENTS.md`/`CONVENTIONS.md` in parallel from `pr.base.sha`.
3. The resulting `PRContext` (now carrying `repoConventions`) is POSTed to `agents`'s `/review` endpoint as before — no change to the request shape's transport, just one more optional field.
4. Each review agent's prompt-building step includes the repo-conventions block when present, exactly like it already does for project memory / predecessor context.

## Error Handling

- **Neither `AGENTS.md` nor `CONVENTIONS.md` exists** (true for most repos today): `repoConventions` is `undefined`/`None`, no prompt block is added — reviews behave exactly as they do today. This is the default path for every existing test and for most real repos at launch.
- **GitHub API error fetching the file** (rate limit, transient failure, non-404 error): logged, treated the same as "file doesn't exist" — never fails or delays the review over this.
- **Oversized file**: truncated to a fixed character cap (same numeric constant/pattern as `MAX_PATCH_CHARS` in `agents/base.py`, mirrored on the webhook side) rather than rejected — a huge AGENTS.md still contributes whatever fits rather than being dropped entirely.

## Testing

- `packages/webhook/src/pr-fetcher.test.ts` (confirmed existing file) — new tests for `fetchAgentsDoc`: fetches `AGENTS.md` when present, falls back to `CONVENTIONS.md` when `AGENTS.md` is absent, returns `null` on double-404, returns `null` (not throw) on a non-404 API error. Matches the existing `fetchAreteYaml` test file's mocking conventions exactly.
- `packages/agents/tests/test_agents.py` — a test confirming the repo-conventions block appears in the built prompt when `pr_context.repo_conventions` is set, and does not appear when it's `None` (matching the existing `project_memories` test pattern, if one exists, or the general `_build_user_prompt` testing convention in this file).
- `packages/agents/tests/test_models.py` — `PRContext` accepts `repoConventions` (camelCase alias) and defaults to `None` when absent, matching the existing alias-acceptance tests for other optional fields.

## Out of Scope

- SP3b (cross-PR review memory persistence) — separate spec, separate brainstorm, deferred per the earlier decomposition discussion.
- Any file other than `AGENTS.md`/`CONVENTIONS.md` (e.g. `.cursorrules`, `CLAUDE.md`) — not requested, can be added later if there's real demand.
- Any UI/dashboard surface showing that a repo's AGENTS.md was picked up — purely a backend prompt-injection feature in this round.
