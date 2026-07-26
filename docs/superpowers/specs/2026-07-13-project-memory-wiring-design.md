# Project Memory Read-Side Wiring — Design Spec

**Date:** 2026-07-13
**Branch:** `main` (docs lane; implementation will branch off this spec)
**Package lanes touched:** `packages/webhook` only
**Master plan:** SP3b of the Kuma competitor-research master plan (see memory `project-arete-context-mapping-cmp`) — the remaining half of SP3 after SP3a ("Repo Conventions") shipped.

## Goal

Close an already-half-built loop: a human replying to Areté's bot comment on a PR can already trigger the ChatAgent to persist a `save_memory` action into the `AgentMemory` table (`packages/webhook/src/chat-handler.ts`). Every review agent already reads `PRContext.project_memories` and injects it into the prompt (`packages/agents/src/arete_agents/agents/base.py`). **But nothing on the webhook side ever queries `AgentMemory` back out and populates `PRContext.projectMemories` before a new review runs** — memories get saved, then silently ignored forever. This spec adds exactly that missing query and wiring.

## Why this is a small, narrow addition

Both ends of this feature already exist and are already tested:
- **Write side:** `chat-handler.ts:111` — `prisma.agentMemory.create(...)` when the chat pipeline emits a `save_memory` action.
- **Read side:** `agents/base.py:149-150` — `if getattr(pr_context, "project_memories", None): prompt += "\n\nPROJECT MEMORY:\n" + ...`.
- **Schema:** the `AgentMemory` Prisma model (`packages/db/prisma/schema.prisma`) already exists — `repositoryId`, `kind`, `title`, `body`, `status` (`"active"`/`"archived"`), indexed on `[repositoryId, status]`.

This spec's entire job is one new query function and 3 call sites wiring it into the review pipeline — no schema change, no new persistence, no changes to `agents/base.py` or the chat pipeline.

## Architecture

```
packages/webhook/src/persistence.ts (modify)
  fetchProjectMemories(provider: ScmProvider, repositoryExternalId: number): Promise<string[]>
    Looks up Repository via the same provider_externalId unique constraint
    persistReview() already uses. If no Repository row exists yet (this
    installation has never had a review persisted), returns [] — there
    cannot be any AgentMemory rows for a repository that doesn't exist.
    Otherwise queries AgentMemory where repositoryId = repo.id AND
    status = "active", ordered by createdAt desc, capped at
    MAX_PROJECT_MEMORIES (20) to bound prompt growth, and returns each
    row's body as a plain string array (matching PRContext.projectMemories'
    existing list[str] shape on the Python side).

packages/webhook/src/worker.ts (modify)
  processGitHubPullRequest, processGitHubCheckRun (both modify)
    One new line alongside the existing telemetry/clone-context
    attachment: prContext.projectMemories = await
    fetchProjectMemories('github', repositoryExternalId).
    processGitLabMergeRequest is explicitly NOT touched in this round
    (GitLab scope deferred — AgentMemory is currently only ever written
    via the GitHub chat-reply flow, so a GitLab repo could never have any
    memories to fetch yet regardless).
```

## Data Flow

1. A human replies to Areté's bot comment on a GitHub PR with something like "remember: we use tabs, not spaces" (already-built flow).
2. The chat pipeline may emit a `save_memory` action; `chat-handler.ts` persists it to `AgentMemory` for that repository (already-built).
3. On the NEXT PR for that same repository, `processGitHubPullRequest`/`processGitHubCheckRun` calls the new `fetchProjectMemories('github', repositoryExternalId)`, gets back up to 20 active memory bodies, and attaches them to `prContext.projectMemories`.
4. `runReviewPipeline` POSTs the now-populated `PRContext` to `agents`'s `/review` endpoint — `PRContext.project_memories` already exists on the Python side, no change needed there.
5. Every review agent's prompt already includes a `PROJECT MEMORY:` block when `project_memories` is non-empty (already-built).

## Error Handling

- **No Repository row yet** (first-ever review for this installation): `fetchProjectMemories` returns `[]`. Matches every other optional-context fetch in this pipeline (telemetry, `.arete.yml`, `AGENTS.md`) — never blocks or fails the review.
- **Database error during the lookup**: not explicitly caught inside `fetchProjectMemories` itself — this matches `reviewExists`'s existing behavior (no try/catch; a DB outage during this cheap read is treated as a genuine infrastructure failure worth surfacing, not silently swallowed, consistent with how `persistReview`'s own DB calls behave). The queue's existing job-retry mechanism handles transient failures at the job level, same as it already does for the rest of `processGitHubPullRequest`.
- **A repo with zero active `AgentMemory` rows** (the overwhelming majority of repos today, since this write path only fires when a human explicitly asks the bot to remember something): `fetchProjectMemories` returns `[]`, `prContext.projectMemories` is an empty array, `agents/base.py`'s existing `if getattr(...)` guard is falsy for an empty list, no prompt block is added — reviews behave exactly as they do today.

## Testing

- `packages/webhook/src/persistence.test.ts` (confirmed existing file — already covers `reviewExists`/`persistReview`) — new tests for `fetchProjectMemories`: returns memory bodies for an existing repo with active memories, in `createdAt desc` order; excludes `"archived"`-status memories; returns `[]` for a repo with no memories; returns `[]` when no Repository row exists for that `(provider, externalId)` pair; caps at 20 results when more than 20 active memories exist.
- `packages/webhook/src/worker.test.ts` (confirmed existing file) — confirms `prContext.projectMemories` is populated from `fetchProjectMemories`'s return value before the pipeline runs.

## Out of Scope

- Predecessor Chains (`predecessor_handoff_notes`/`predecessor_root_cause`) — a separate, more ambiguous feature (what counts as "a predecessor PR" is an undecided product question) — deferred to its own future brainstorm, not part of this spec.
- `auto_resolver.py` — an entirely separate, fully-mocked stub (fake DB, fake GitHub API calls) from an earlier commit; unrelated to this feature and not touched here.
- GitLab support for project memories — deferred; `AgentMemory` currently has no write path from GitLab merge requests, so there is nothing to fetch yet on that path.
- Any UI/dashboard surface for viewing or managing a repo's saved memories — purely a backend wiring feature in this round.
- Any change to how memories are written (the `save_memory` chat action, its triggering logic, or the `kind`/`title` fields) — this spec only adds the read side.
