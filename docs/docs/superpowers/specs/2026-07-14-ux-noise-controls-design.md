# SP6: UX Noise Controls — Design

**Status:** Approved, ready for planning
**Package lanes:** `packages/agents` (tool + orchestrator wiring), `packages/webhook` (posting suppression + persistence + escalation), `packages/db` (one schema field addition)

## Context

`packages/db/prisma/schema.prisma`'s `ReviewComment` model already has `noiseState` (default `"OPEN"`), `escalateOn`, and `threshold` fields, added by an already-merged commit (`5d83c77`, "Intelligent Noise Classification (Phase 2)"). Three pieces of scaffolding exist to use them, but all are fully mocked with zero real persistence:

- `packages/agents/src/arete_agents/tools/actions.py` registers two LangChain tools an agent can call today during a review — `silence_as_noise(issue_id, reason)` and `place_under_observation(issue_id, escalate_on, threshold, reason)` — but each just returns a canned success string with a `# Simulate API call to DB` comment. No DB write happens.
- `packages/agents/src/arete_agents/noise_escalator.py` is a standalone `while True` loop meant to escalate `UNDER_OBSERVATION` comments past their threshold. It queries a hardcoded fake array and only logs a warning — never writes state or notifies anyone. Nothing schedules or runs this process anywhere in the repo.
- The dashboard (`packages/dashboard/src`) has zero references to `noiseState`/`escalateOn`/`UNDER_OBSERVATION`/`SILENCED` anywhere — nothing reads or displays this data.

Architecturally, `persistReview()` in `packages/webhook/src/persistence.ts` creates all `ReviewComment` rows in one `createMany` batch **after** the agent pipeline finishes (`result.file_reviews.flatMap(...)`). No `ReviewComment` row — and thus no real database id — exists yet at the moment an agent is running and calling `silence_as_noise(issue_id=...)`. The `issue_id` these tools take today has no real referent.

This design closes the loop for real, following the pattern established by SP3b (`AgentMemory`): find the half-built feature, wire the missing real persistence rather than building something new.

## Goals

1. `silence_as_noise` and `place_under_observation` cause a real, durable effect: the flagged finding is excluded from what gets posted to GitHub, and its state is persisted on a real `ReviewComment` row.
2. An observed issue that recurs across future PRs on the same repository can cross its threshold and become genuinely escalated — visible in the database, without inventing new deployment infrastructure.
3. No fabricated success signals: a tool call that claims to have done something must actually have done it by the time the review completes.

## Out of scope

- Human-facing dashboard controls (e.g. a developer manually silencing/un-silencing a comment). Agent-only for this sub-project.
- External notification (Slack/email) on escalation. Escalation writes real state; surfacing it in a UI is a future follow-up.
- Semantic/LLM-based similarity matching for recurrence detection. Matching uses a simple, deterministic `(repository, path, category)` key.
- GitLab. Mirrors the existing scope precedent set by SP3a/SP3b — GitHub only.

## Architecture

### Part 1: Making silence/observe decisions real

`silence_as_noise`/`place_under_observation` are called by an LLM inside `agents/base.py`'s `review_file()` tool-execution loop, *before* the agent's final JSON (its list of comments) is even parsed. The tool functions themselves cannot reach a database — no comment ID exists yet, and reaching into Prisma from Python mid-run would require a whole new cross-service write path for no benefit. The fix belongs in the deterministic Python code that already owns the tool loop, not inside the tool bodies.

- **`review_file()`** (`agents/base.py`): the existing `for tool_call in response.tool_calls:` loop already sees every tool name and args. When `tool_call["name"]` is `"silence_as_noise"` or `"place_under_observation"`, parse `issue_id` as `"path:line"` and append `{path, line, action, reason, escalate_on, threshold}` to a list local to this call. `review_file()`'s return type changes from `FileReview` to `tuple[FileReview, list[NoiseDecision]]`.
- **`NoiseDecision`** (new Pydantic model, `models/review.py`): `path: str`, `line: int`, `action: Literal["silence", "observe"]`, `reason: str`, `escalate_on: str | None = None`, `threshold: int | None = None`.
- **`orchestrator.py`**: `GraphState` gains `noise_decisions: Annotated[list[NoiseDecision], operator.add]`, mirroring the existing `raw_reviews` reducer exactly. `_execute_agent_review` unpacks the new tuple return and includes both halves in its returned dict. `_synthesize_reviews` applies decisions **after** `_apply_critic`/`_apply_grounding` (both of which can drop or renumber comments) and before `decide_verdict`: for every `(path, line)` match between a surviving comment and a recorded decision, stamp `noise_state`/`escalate_on`/`threshold` onto that comment. This is a deterministic Python match — it never trusts the LLM's own JSON to self-report noise state.
- **`ReviewComment`** (`models/review.py`) gains three fields: `noise_state: Literal["OPEN", "SILENCED", "UNDER_OBSERVATION", "ESCALATED"] = "OPEN"`, `escalate_on: str | None = None`, `threshold: int | None = None`.
- **Webhook mirror types** (`packages/webhook/src/types.ts`): `ReviewComment` gains `noiseState`, `escalateOn`, `threshold` (mirrors the Python fields, same naming convention as the rest of this codebase's Python-snake/TS-camel mirrors).
- **`persistence.ts`'s `persistReview`**: the `comments.createMany.data` mapping currently never sets these 3 columns (they silently take schema defaults). Add `noiseState: c.noiseState ?? 'OPEN'`, `escalateOn: c.escalateOn ?? null`, `threshold: c.threshold ?? null` to each row.
- **`comment-poster.ts`**: add a filter — only comments with `noiseState === 'OPEN'` are posted to GitHub — sitting alongside the existing `MAX_VALID_LINE` and fingerprint-dedup filters in `postReview()`. This is what makes the tool's own existing docstring promise ("Silenced issues will never be posted to GitHub" / "It stays quiet until the escalation trigger trips") literally true for the first time.

A finding that's silenced or placed under observation is **not** dropped before persistence — it still becomes a real `ReviewComment` row (audit trail preserved), it is just excluded from the GitHub post.

### Part 2: Escalation (recurrence across PRs)

`escalateOn`/`threshold` (`"events_per_minute"`, `"additional_events"`) read like a live-incident monitor, but a `ReviewComment` is a one-time artifact of a single PR review — it has no ongoing occurrence rate of its own. The concrete meaning for this product: **the same kind of issue recurring across separate PR reviews on the same repository.**

`noise_escalator.py`'s standalone `while True` loop is retired (deleted, not left as dead scaffolding) — this repo has no existing deployment/cron infrastructure for a standalone Python worker, and the natural trigger point ("a new review just completed for this repo") already runs synchronously in the webhook's `persistReview`. Folding escalation in there avoids inventing new infrastructure for a check that fits naturally into an existing one.

- **Schema addition**: `ReviewComment` gains `occurrenceCount Int @default(1)`.
- **In `persistReview`**, before inserting this review's new comments: for each incoming comment with `noiseState === 'UNDER_OBSERVATION'`, look up an existing `ReviewComment` on the same `repositoryId` with the same `(path, category)` that is *also* `UNDER_OBSERVATION` (via its parent `Review.repositoryId`).
  - If found: increment its `occurrenceCount`. If the incremented count `>= threshold`, set its `noiseState` to `'ESCALATED'`. The new incoming comment for this review is still created as its own row (each PR's finding is a distinct artifact), but does not itself carry the accumulated count — the count lives on the original observed comment.
  - If not found: this is the first time this issue was observed; create the new row as usual with `occurrenceCount: 1`.
- Matching key is deliberately simple: `(repositoryId, path, category)` — no semantic/embedding-based similarity. This is an explicit YAGNI choice, not an oversight.

## Error handling

- All new webhook-side persistence changes inherit `persistReview`'s existing non-fatal contract: a failure here must never block a review that's already been posted. The escalation lookup/increment happens inside the same function and follows the same "log and continue" posture as the rest of `persistReview` — no new failure mode introduced.
- If `review_file()`'s tool loop records a decision for a `(path, line)` that doesn't survive synthesis/critic/grounding (e.g. the finding was dropped as a duplicate or unverified), the decision is simply never matched and has no effect — not an error, just a no-op, consistent with how `dropped_count`/`critic_dropped_count` already handle comments that don't make it to the final result.
- `MAX_TOOL_ROUNDS` (existing constant in `base.py`) already bounds the tool loop; no new bound is needed for noise-tool calls specifically.

## Testing

- Python: `packages/agents/tests/test_agents.py` (covers `base.py`'s `review_file()`) extends to cover `silence_as_noise`/`place_under_observation` tool calls, asserting the returned `NoiseDecision` list matches the tool args. `packages/agents/tests/test_orchestrator.py` extends to verify a recorded decision stamps the matching comment's `noise_state`/`escalate_on`/`threshold` after synthesis, and that a decision with no matching surviving comment is a silent no-op.
- TypeScript: `packages/webhook/src/persistence.test.ts` extends `persistReview`'s existing test suite to assert `noiseState`/`escalateOn`/`threshold` are written from the incoming comment data (not silently dropped), and adds new cases for the escalation counter (first observation creates a row with `occurrenceCount: 1`; a matching second observation increments the existing row instead of creating a new one; crossing `threshold` sets `noiseState` to `'ESCALATED'`). `packages/webhook/src/comment-poster.test.ts` extends to assert a `SILENCED`/`UNDER_OBSERVATION` comment is excluded from the GitHub payload while an `OPEN` comment in the same review is still posted.

## Deferred follow-ups (not part of this sub-project)

- Dashboard UI to display `ESCALATED`/`SILENCED`/`UNDER_OBSERVATION` comments.
- Human-facing manual silence/un-silence control.
- External notification (Slack/email) on escalation.
- Semantic similarity matching for recurrence detection beyond `(repository, path, category)`.
