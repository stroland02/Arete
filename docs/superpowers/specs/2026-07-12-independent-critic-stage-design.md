# Independent Critic Stage — Design Spec

**Date:** 2026-07-12
**Status:** Approved design, pending build
**Branch:** to be created off `main`, `agents`+`docs` package lane only

## Context

Research (`docs/superpowers/research/2026-07-11-code-review-agent-quality-research.md`)
found the top code-review agents win via harness + context + a critic stage,
and identified an independent, evidence-gated cross-model critic as the
single highest-leverage lever for cutting false positives. This is next on
the ordered roadmap (`project-arete-dev-roadmap` memory).

Investigated the current pipeline (`orchestrator.py`) and confirmed the
existing `SynthesizerAgent.synthesize()` already does *some* verification —
it merges raw per-agent comments, drops ones it judges low-confidence or
hallucinated, and reports `dropped_count` — but this is the **same model
grading its own merged output** in one call, not an independent check. The
research's actual recommendation (a separate model, evidence-gated) doesn't
exist yet.

## Decisions

- **Critic model: opposite tier of the finding's author.** An opus-authored
  finding (security, business_logic, deployment_safety categories) is
  critiqued by sonnet; a sonnet-authored finding (performance, quality,
  test_coverage) is critiqued by opus. Reuses the two-tier infra shipped
  this session (`config.py` tier fields, `llm/base.py` `get_llms_by_role`);
  no new model wiring, and a different capability tier is more likely to
  catch a different class of mistake than a same-tier peer or a self-check.
- **Critic action: binary keep/drop only.** No severity edits. Matches the
  research's "evidence-gated" framing and avoids the critic introducing new
  unverified judgment calls beyond "is this backed by the diff."
- **Placement: additive, after the existing Synthesizer.** The Synthesizer's
  merge/dedup/self-verify pass stays untouched — it does real, tested work
  (merging duplicates across agents, structuring the JSON, its own
  hallucination catch). The critic runs as a new, independent second gate on
  the Synthesizer's *output*, not a replacement.

## Grounding (what is real, verified 2026-07-12)

- `ReviewComment.category` (`models/review.py`) is set to the originating
  agent's `agent_name` by every specialist agent's own prompt template
  (`agents/base.py` line 94: `"category": "{self.agent_name}"`), and
  category values are exactly the 6 `ROLE_KEYS` specialist role names
  (security, performance, quality, test_coverage, deployment_safety,
  business_logic) — confirmed by reading `agents/base.py` and
  `orchestrator.py`'s agent list.
- `role_tiers(settings)` (`llm/base.py`) already maps every role key to its
  configured tier via 9 `Settings` fields (`config.py`); defaults are opus
  for security/business_logic/deployment_safety/ci_diagnostics/synthesizer,
  sonnet for performance/quality/test_coverage/chat.
- `get_llms_by_role(settings)` builds **at most one client per distinct
  tier actually in use** (`set(tiers.values())`) — under an edge-case config
  where every role happens to resolve to the same tier, only one client
  would exist today. The critic needs both tiers guaranteed available
  regardless of how the 9 configurable roles are set.
- `FileChange.patch` (`models/pr.py`) holds the diff content per file — this
  is what the critic verifies comments against, same source the specialist
  agents and Synthesizer already use.

## Architecture

### 1. Guarantee both critic tiers exist

Add two new **fixed-tier** role keys to `ROLE_KEYS` (`llm/base.py`) and
`role_tiers()`: `critic_opus` (always `"opus"`, not env-configurable) and
`critic_sonnet` (always `"sonnet"`, not env-configurable). This makes
`get_llms_by_role()`'s `set(tiers.values())` always include both tiers,
so both critic clients are always built regardless of the 9 configurable
roles' actual settings. In the single-client constructor path (tests /
simple callers that pass one shared `BaseChatModel` for every role),
`critic_opus` and `critic_sonnet` both resolve to that same shared client —
a benign no-op (the critic runs the same model on itself), not a bug.

### 2. `CriticAgent`

New module `packages/agents/src/arete_agents/critic.py`, structurally
similar to `SynthesizerAgent`:

```python
class CriticAgent:
    def __init__(self, llm: BaseChatModel) -> None: ...

    def critique(
        self,
        pr: PRContext,
        comments: list[ReviewComment],
    ) -> set[int]:
        """Given already-synthesized comments (indexed 0..len-1 in the order
        passed), independently re-verify each against its file's diff
        content in `pr.files`. Returns the set of indices to DROP (empty
        set if none)."""
```

Prompt pattern: system prompt instructs the critic to independently verify
each comment against the diff content shown for its `path` (looked up from
`pr.files`), returning ONLY the indices of comments that are NOT
evidence-backed (do not reference a real line/symbol/pattern actually
present in that file's diff). Mirrors the Synthesizer's step-3 verification
language but is a structurally separate call, on a different model, on
already-narrowed input — genuinely independent, not a duplicate of the
Synthesizer's own check.

If the LLM call raises or returns unparseable JSON, `critique()` returns an
empty set (fail open — see Error Handling below), logging a warning.

### 3. Orchestrator wiring

New method on `ReviewOrchestrator`, called from `_synthesize_reviews` (or a
new graph node `critique_reviews` added after `synthesize_reviews` — either
is acceptable; implementer's call, note the choice in the PR) immediately
after `final_result` is produced and before it's returned/stored:

```python
def _apply_critic(self, pr: PRContext, result: ReviewResult) -> ReviewResult:
    tiers = role_tiers(self._settings)  # or pass tiers in at __init__ time
    # Flatten (file_review_index, comment_index, comment) preserving location
    flat: list[tuple[int, int, ReviewComment]] = [
        (fi, ci, c)
        for fi, fr in enumerate(result.file_reviews)
        for ci, c in enumerate(fr.comments)
    ]

    opus_authored = [(fi, ci, c) for fi, ci, c in flat if tiers.get(c.category) == "opus"]
    sonnet_authored = [(fi, ci, c) for fi, ci, c in flat if tiers.get(c.category) == "sonnet"]
    unrecognized = [(fi, ci, c) for fi, ci, c in flat if c.category not in tiers]
    # unrecognized categories are kept as-is, uncritiqued (defensive —
    # should not happen given the 6 fixed specialist category values, but
    # never silently drop on an unexpected category)

    drop_keys: set[tuple[int, int]] = set()

    if opus_authored:
        idx_map = list(range(len(opus_authored)))
        dropped = self._critic_sonnet.critique(pr, [c for _, _, c in opus_authored])
        drop_keys |= {(opus_authored[i][0], opus_authored[i][1]) for i in dropped}

    if sonnet_authored:
        dropped = self._critic_opus.critique(pr, [c for _, _, c in sonnet_authored])
        drop_keys |= {(sonnet_authored[i][0], sonnet_authored[i][1]) for i in dropped}

    # Rebuild file_reviews keeping only non-dropped comments
    new_file_reviews = []
    for fi, fr in enumerate(result.file_reviews):
        kept = [c for ci, c in enumerate(fr.comments) if (fi, ci) not in drop_keys]
        new_file_reviews.append(FileReview(path=fr.path, comments=kept, summary=fr.summary))

    result.file_reviews = new_file_reviews
    result.critic_dropped_count = len(drop_keys)
    return result
```

(Pseudocode above establishes exact behavior; implementer writes real,
tested code — this is not meant to be copy-pasted verbatim without
adjusting to the actual constructor/attribute names chosen.)

### 4. `ReviewResult` schema change

Add one field to `models/review.py`:

```python
critic_dropped_count: int = 0
```

Same shape/intent as the existing `dropped_count` field — tracked
separately so each gate's contribution stays individually observable (both
numbers matter for future UI/telemetry use, e.g. the dashboard's
Synthesizer-hourglass-style copy).

## Error Handling

- **A critic LLM call fails or returns unparseable output:** fail open —
  that bucket's comments are kept, uncritiqued, and a warning is logged.
  Matches the existing defensive pattern in `_synthesize_reviews` (falls
  back to a blind merge rather than losing all raw reviews on a Synthesizer
  failure). A critic-stage outage must never silently empty a review.
- **An empty bucket** (e.g. a small PR where only one tier's agents found
  anything) skips that critic call entirely — no wasted LLM call.
- **An unrecognized `category`** (should not occur given the 6 fixed
  specialist categories, but defensively handled): comment is kept as-is,
  uncritiqued, never dropped by default.

## Testing (pytest, fake/stub LLM clients — no real API key needed)

New `test_critic.py`:
- `CriticAgent.critique()` returns the correct drop-index set for a
  fake-LLM response that flags specific indices.
- Malformed/unparseable LLM response → empty drop set (fail open), warning
  logged.

Extend `test_orchestrator.py` (or a new `test_critic_integration.py`):
- A comment that survives the Synthesizer's self-check but is flagged by
  the critic is dropped from the final `ReviewResult` — proves the two
  gates are genuinely independent, not redundant.
- Opus-authored comments are routed to the sonnet critic client and
  vice versa — assert via distinct fake clients per tier, checking which
  client received which comments.
- Empty bucket → that critic client is never invoked.
- Critic call raises → bucket's comments survive unfiltered,
  `critic_dropped_count` unaffected for that bucket.
- `critic_dropped_count` accounts correctly across both buckets combined.
- Single-shared-client constructor path (existing ~20 test call sites)
  still passes unmodified — `critic_opus`/`critic_sonnet` both resolve to
  the same shared client, self-critiquing is a no-op difference, not a
  failure.

Extend `test_model_tiers.py`: `role_tiers()` includes `critic_opus` (always
`"opus"`) and `critic_sonnet` (always `"sonnet"`) regardless of the other 9
roles' configured tiers; `get_llms_by_role()` always produces both a
`"opus"` and a `"sonnet"` client even when every configurable role is set to
the same tier via env override.

Full suite must stay green: `uv run pytest tests/ --ignore=tests/test_e2e_smoke.py`
(baseline **155 passed + 1 skipped**, per current roadmap memory).

## Out of scope (explicit follow-ups)

- **Real-baseline measurement.** Both `ANTHROPIC_API_KEY` and
  `GEMINI_API_KEY` in the repo-root `.env` are invalid stubs (confirmed
  2026-07-12: 27 and 24 chars respectively; real keys are much longer).
  Once a valid key exists, re-run the eval harness's
  `--update-baseline` before/after this change lands to get a real
  precision/recall delta — this is exactly what the harness was built to
  measure. Not blocking this build (all tests here use fake LLM clients).
- **Critic severity edits** (upgrade/downgrade, not just keep/drop) —
  deliberately deferred per the "binary only" decision above; can be a
  later iteration if the binary version proves too blunt in practice.
- **Surfacing `critic_dropped_count` in the dashboard UI** (e.g. alongside
  the existing `dropped_count` in Synthesizer-hourglass-style copy) — a
  dashboard-lane follow-up, not part of this agents-lane change.
