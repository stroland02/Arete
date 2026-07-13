# Independent Critic Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a genuinely independent, cross-tier critic stage after the Synthesizer that drops any finding not evidence-backed against the diff — the research-documented #1 lever for cutting AI-reviewer false positives.

**Architecture:** Two new fixed-tier role keys (`critic_opus`, `critic_sonnet`) guarantee both tier clients always exist. A new `CriticAgent` class independently re-verifies a batch of already-synthesized comments against their diffs, binary keep/drop only. The orchestrator routes each surviving comment's category to the *opposite*-tier critic (opus-authored → sonnet critic, sonnet-authored → opus critic) as a new step at the end of `_synthesize_reviews`, strictly after today's Synthesizer output — additive, not a replacement.

**Tech Stack:** Python, LangChain (`BaseChatModel`, `with_retry`), pytest with `MagicMock`/`AIMessage` fakes (no real API key needed to build or test this).

## Global Constraints

- Critic model is always the **opposite tier** of the finding's category author (opus-authored → sonnet critiques it; sonnet-authored → opus critiques it).
- Critic action is **binary keep/drop only** — no severity edits.
- The existing Synthesizer merge/dedup/self-verify pass (`SynthesizerAgent.synthesize`) is **untouched** — the critic is an additive second gate on its output.
- **Fail open** on any critic error (LLM exception, unparseable JSON, missing key): the affected bucket's comments survive uncritiqued. A critic-stage outage must never silently empty a review.
- Empty buckets skip their critic call entirely — no wasted LLM call.
- An unrecognized comment `category` is kept as-is, uncritiqued (defensive; should not occur given the 6 fixed specialist categories).
- All ~20 existing test call sites that construct `ReviewOrchestrator(llm=...)` with no `tiers` argument must keep passing unmodified.
- Full suite must stay green throughout: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py` (baseline **155 passed + 1 skipped**).
- Branch off latest `origin/main`, `agents`+`docs` lane only. Verify `git branch --show-current` before every commit (multi-agent repo).

---

### Task 1: Add `critic_opus`/`critic_sonnet` fixed-tier role keys

**Files:**
- Modify: `packages/agents/src/arete_agents/llm/base.py`
- Modify: `packages/agents/tests/test_model_tiers.py`

**Interfaces:**
- Produces: `ROLE_KEYS` now has 11 entries (was 9); `role_tiers(settings)` output now has 11 keys, with `critic_opus` always `"opus"` and `critic_sonnet` always `"sonnet"` regardless of `settings` (these two are intentionally NOT env-configurable — no new `Settings` fields needed).

- [ ] **Step 1: Update `ROLE_KEYS` and `role_tiers()`**

In `packages/agents/src/arete_agents/llm/base.py`, change:

```python
ROLE_KEYS: tuple[str, ...] = (
    "security",
    "performance",
    "quality",
    "test_coverage",
    "deployment_safety",
    "business_logic",
    "ci_diagnostics",
    "synthesizer",
    "chat",
)
```

to:

```python
ROLE_KEYS: tuple[str, ...] = (
    "security",
    "performance",
    "quality",
    "test_coverage",
    "deployment_safety",
    "business_logic",
    "ci_diagnostics",
    "synthesizer",
    "chat",
    # Fixed-tier critic roles (independent verification stage) — always
    # opus/sonnet respectively, deliberately not env-configurable via
    # Settings, so both critic tiers are always available regardless of
    # how the 9 roles above are configured. See ReviewOrchestrator._apply_critic.
    "critic_opus",
    "critic_sonnet",
)
```

And change `role_tiers()` from:

```python
def role_tiers(settings: Settings) -> dict[str, str]:
    """Map each role key to its configured Claude tier ("opus" | "sonnet")."""
    return {
        "security": settings.security_tier,
        "performance": settings.performance_tier,
        "quality": settings.quality_tier,
        "test_coverage": settings.test_coverage_tier,
        "deployment_safety": settings.deployment_safety_tier,
        "business_logic": settings.business_logic_tier,
        "ci_diagnostics": settings.ci_tier,
        "synthesizer": settings.synthesizer_tier,
        "chat": settings.chat_tier,
    }
```

to:

```python
def role_tiers(settings: Settings) -> dict[str, str]:
    """Map each role key to its configured Claude tier ("opus" | "sonnet")."""
    return {
        "security": settings.security_tier,
        "performance": settings.performance_tier,
        "quality": settings.quality_tier,
        "test_coverage": settings.test_coverage_tier,
        "deployment_safety": settings.deployment_safety_tier,
        "business_logic": settings.business_logic_tier,
        "ci_diagnostics": settings.ci_tier,
        "synthesizer": settings.synthesizer_tier,
        "chat": settings.chat_tier,
        # Fixed, not settings-derived — see ROLE_KEYS comment above.
        "critic_opus": "opus",
        "critic_sonnet": "sonnet",
    }
```

- [ ] **Step 2: Update the existing exact-equality test**

In `packages/agents/tests/test_model_tiers.py`, `test_role_tiers_defaults_match_spec` currently asserts an exact 9-key dict. Update it:

```python
def test_role_tiers_defaults_match_spec():
    tiers = role_tiers(_settings())
    assert tiers == {
        "security": "opus",
        "performance": "sonnet",
        "quality": "sonnet",
        "test_coverage": "sonnet",
        "deployment_safety": "opus",
        "business_logic": "opus",
        "ci_diagnostics": "opus",
        "synthesizer": "opus",
        "chat": "sonnet",
        "critic_opus": "opus",
        "critic_sonnet": "sonnet",
    }
```

- [ ] **Step 3: Add new tests for the fixed-tier behavior**

Append to `packages/agents/tests/test_model_tiers.py`:

```python
def test_critic_tiers_are_fixed_regardless_of_role_overrides():
    """critic_opus/critic_sonnet never change even if every configurable
    role is overridden to the same tier via env."""
    tiers = role_tiers(_settings(
        security_tier="sonnet", business_logic_tier="sonnet",
        deployment_safety_tier="sonnet", ci_tier="sonnet",
        synthesizer_tier="sonnet", chat_tier="sonnet",
    ))
    assert tiers["critic_opus"] == "opus"
    assert tiers["critic_sonnet"] == "sonnet"


def test_get_llms_by_role_always_builds_both_tiers_for_critic():
    """Even when every one of the 9 configurable roles resolves to the same
    tier, get_llms_by_role must still build BOTH an opus and a sonnet
    client, because critic_opus/critic_sonnet are fixed."""
    llms = get_llms_by_role(_settings(
        security_tier="sonnet", business_logic_tier="sonnet",
        deployment_safety_tier="sonnet", ci_tier="sonnet",
        synthesizer_tier="sonnet", chat_tier="sonnet",
    ))
    assert llms["critic_opus"] is not llms["critic_sonnet"]
    assert len({id(c) for c in llms.values()}) == 2
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/agents && uv run pytest tests/test_model_tiers.py -v`
Expected: all pass, including the 2 new tests and the updated exact-equality test.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/agents/src/arete_agents/llm/base.py packages/agents/tests/test_model_tiers.py
git commit -m "feat(agents): add fixed-tier critic_opus/critic_sonnet role keys"
```

---

### Task 2: Add `critic_dropped_count` to `ReviewResult`

**Files:**
- Modify: `packages/agents/src/arete_agents/models/review.py`
- Test: `packages/agents/tests/test_orchestrator.py` (one new test near the existing `dropped_count` default test)

**Interfaces:**
- Produces: `ReviewResult.critic_dropped_count: int` (default `0`), same shape/intent as the existing `dropped_count` field, tracked separately.

- [ ] **Step 1: Write the failing test**

Append to `packages/agents/tests/test_orchestrator.py`:

```python
def test_review_result_critic_dropped_count_defaults_to_zero(sample_pr):
    """Additive field: existing constructors that don't pass
    critic_dropped_count keep working and get 0."""
    result = ReviewResult(
        pr_context=sample_pr,
        file_reviews=[],
        overall_summary="ok",
        risk_level="low",
    )
    assert result.critic_dropped_count == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agents && uv run pytest tests/test_orchestrator.py::test_review_result_critic_dropped_count_defaults_to_zero -v`
Expected: FAIL — `AttributeError` or pydantic validation, field does not exist yet.

- [ ] **Step 3: Add the field**

In `packages/agents/src/arete_agents/models/review.py`, add after the existing `dropped_count` field:

```python
    # Number of already-synthesized comments the independent critic stage
    # DROPPED as not evidence-backed against the diff (tracked separately
    # from dropped_count — that field is the Synthesizer's own same-model
    # self-check; this one is the genuinely independent cross-tier gate).
    # 0 when the critic bucket was empty or a critic call failed (fail-open).
    critic_dropped_count: int = 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agents && uv run pytest tests/test_orchestrator.py::test_review_result_critic_dropped_count_defaults_to_zero -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/agents/src/arete_agents/models/review.py packages/agents/tests/test_orchestrator.py
git commit -m "feat(agents): add critic_dropped_count field to ReviewResult"
```

---

### Task 3: Build `CriticAgent`

**Files:**
- Create: `packages/agents/src/arete_agents/critic.py`
- Test: `packages/agents/tests/test_critic.py`

**Interfaces:**
- Consumes: `ReviewComment`, `FileReview` from `arete_agents.models.review`; `PRContext`, `FileChange` from `arete_agents.models.pr`; `BaseChatModel` from `langchain_core.language_models`; `HumanMessage`/`SystemMessage` from `langchain_core.messages`.
- Produces: `CriticAgent(llm: BaseChatModel)` with `.critique(pr: PRContext, comments: list[ReviewComment]) -> set[int]` — returns the set of 0-based indices into `comments` to DROP. Empty set on any error (fail open). Consumed by Task 4's orchestrator wiring.

- [ ] **Step 1: Write the failing tests**

Create `packages/agents/tests/test_critic.py`:

```python
from unittest.mock import MagicMock

from langchain_core.messages import AIMessage

from arete_agents.critic import CriticAgent
from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import ReviewComment


def _pr_with_file(path: str, patch: str) -> PRContext:
    return PRContext(
        repo="acme/api",
        pr_number=1,
        title="Test",
        description="",
        files=[FileChange(path=path, patch=patch, additions=1, deletions=0)],
    )


def _make_llm(response: str) -> MagicMock:
    mock = MagicMock()
    mock.with_retry.return_value = mock
    mock.invoke.return_value = AIMessage(content=response)
    return mock


def _comment(body: str, category: str = "security") -> ReviewComment:
    return ReviewComment(
        path="src/auth.py", line=1, body=body, severity="error", category=category
    )


def test_critique_returns_drop_indices_from_response():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    comments = [_comment("Real SQL injection."), _comment("Hallucinated frobnicate() call.")]
    llm = _make_llm('{"drop_indices": [1]}')

    dropped = CriticAgent(llm).critique(pr, comments)

    assert dropped == {1}


def test_critique_returns_empty_set_when_response_has_no_dropped():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    comments = [_comment("Real SQL injection.")]
    llm = _make_llm('{"drop_indices": []}')

    dropped = CriticAgent(llm).critique(pr, comments)

    assert dropped == set()


def test_critique_fails_open_on_unparseable_response():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    comments = [_comment("Real SQL injection.")]
    llm = _make_llm("Sorry, I can't produce JSON right now.")

    dropped = CriticAgent(llm).critique(pr, comments)

    assert dropped == set()


def test_critique_fails_open_when_llm_raises():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    comments = [_comment("Real SQL injection.")]
    llm = MagicMock()
    llm.with_retry.return_value = llm
    llm.invoke.side_effect = RuntimeError("provider outage")

    dropped = CriticAgent(llm).critique(pr, comments)

    assert dropped == set()


def test_critique_ignores_out_of_range_indices():
    """Defensive: an LLM response naming an index outside the comments list
    must not raise or corrupt the result — just be filtered out."""
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    comments = [_comment("Real SQL injection.")]
    llm = _make_llm('{"drop_indices": [0, 5, -1]}')

    dropped = CriticAgent(llm).critique(pr, comments)

    assert dropped == {0}


def test_critique_with_empty_comments_list_makes_no_llm_call():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users")
    llm = MagicMock()
    llm.with_retry.return_value = llm

    dropped = CriticAgent(llm).critique(pr, [])

    assert dropped == set()
    llm.invoke.assert_not_called()


def test_critique_prompt_includes_diff_and_comment_bodies():
    pr = _pr_with_file("src/auth.py", "+SELECT * FROM users WHERE id=")
    comments = [_comment("Real SQL injection.")]
    llm = _make_llm('{"drop_indices": []}')

    CriticAgent(llm).critique(pr, comments)

    human_content = llm.invoke.call_args[0][0][1].content
    assert "SELECT * FROM users WHERE id=" in human_content
    assert "Real SQL injection." in human_content
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && uv run pytest tests/test_critic.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'arete_agents.critic'`.

- [ ] **Step 3: Write the implementation**

Create `packages/agents/src/arete_agents/critic.py`:

```python
import json
import logging
import re

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.models.pr import PRContext
from arete_agents.models.review import ReviewComment

_SYSTEM_PROMPT = """You are the Areté independent Critic — a SEPARATE model \
from whichever agent produced the comments below. Your job is to catch \
mistakes the original author might miss about its own work.

For EACH comment listed, independently verify it against the diff content \
shown for its file. A comment is evidence-backed ONLY if it references a \
real line, symbol, or pattern that is actually visible in that file's diff. \
Do not give the benefit of the doubt — if you cannot point to the exact \
evidence in the diff, it is NOT evidence-backed.

Return ONLY valid JSON with this exact structure:
{
  "drop_indices": [<integer indices of comments that are NOT evidence-backed>]
}

If every comment is evidence-backed, return {"drop_indices": []}."""


class CriticAgent:
    def __init__(self, llm: BaseChatModel) -> None:
        self._llm = llm

    def critique(self, pr: PRContext, comments: list[ReviewComment]) -> set[int]:
        if not comments:
            return set()

        patches_by_path = {f.path: f.patch for f in pr.files}

        comment_blocks = []
        for i, c in enumerate(comments):
            diff = patches_by_path.get(c.path, "(no diff available for this path)")
            comment_blocks.append(
                f"""<comment index="{i}">
File: {c.path}
Line: {c.line}
Category: {c.category}
Body: {c.body}
<diff>
{diff}
</diff>
</comment>"""
            )

        user_prompt = f"""Critique the following {len(comments)} comment(s) \
for PR #{pr.pr_number}:

{chr(10).join(comment_blocks)}"""

        messages = [
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=user_prompt),
        ]

        try:
            llm_with_retry = self._llm.with_retry(stop_after_attempt=2)
            response = llm_with_retry.invoke(messages)
            raw = response.content if isinstance(response.content, str) else ""
            clean = re.sub(r"```(?:json)?\n?|```$", "", raw, flags=re.MULTILINE).strip()
            data = json.loads(clean)
            raw_indices = data.get("drop_indices", [])
            return {
                i for i in raw_indices
                if isinstance(i, int) and 0 <= i < len(comments)
            }
        except Exception as exc:
            logging.warning(
                f"Critic call failed or returned unparseable output: {exc}. "
                "Failing open — comments in this batch are kept uncritiqued."
            )
            return set()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && uv run pytest tests/test_critic.py -v`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/agents/src/arete_agents/critic.py packages/agents/tests/test_critic.py
git commit -m "feat(agents): add CriticAgent — independent evidence-gated verification"
```

---

### Task 4: Wire the critic stage into `ReviewOrchestrator`

**Files:**
- Modify: `packages/agents/src/arete_agents/orchestrator.py`
- Test: `packages/agents/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `CriticAgent` from Task 3, `critic_dropped_count` field from Task 2, `critic_opus`/`critic_sonnet` from `self._llms` (Task 1 guarantees both keys always present).
- Produces: `ReviewOrchestrator.__init__(self, llm, tiers: dict[str, str] | None = None)` — new optional `tiers` param, defaulting to a static category→tier mapping so all existing test call sites (`ReviewOrchestrator(llm=...)`, no `tiers`) keep working unmodified.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agents/tests/test_orchestrator.py`:

```python
def test_critic_drops_comment_that_survived_synthesizer(sample_pr):
    """A comment that survives the Synthesizer's own self-check must still
    be dropped if the independent critic flags it — proves the two gates
    are genuinely independent, not redundant."""
    from arete_agents.orchestrator import ReviewOrchestrator

    synth_response = (
        '{"file_reviews": [{"path": "src/auth.py", "comments": '
        '[{"path": "src/auth.py", "line": 5, "body": "SQL injection.", '
        '"severity": "error", "category": "security"}], '
        '"summary": "SQL injection."}], '
        '"overall_summary": "One security issue.", "risk_level": "high", '
        '"dropped_count": 0}'
    )
    agent_response = '{"comments": [], "summary": "clean"}'

    def fake_invoke(messages, **kwargs):
        system = messages[0].content
        if "Critic" in system:
            return AIMessage(content='{"drop_indices": [0]}')
        if "Synthesizer" in system:
            return AIMessage(content=synth_response)
        return AIMessage(content=agent_response)

    mock = MagicMock()
    mock.with_retry.return_value = mock
    mock.invoke.side_effect = fake_invoke

    result = ReviewOrchestrator(llm=mock).run(sample_pr)

    assert result.total_comments == 0
    assert result.critic_dropped_count == 1


def test_critic_keeps_comment_it_approves(sample_pr):
    from arete_agents.orchestrator import ReviewOrchestrator

    synth_response = (
        '{"file_reviews": [{"path": "src/auth.py", "comments": '
        '[{"path": "src/auth.py", "line": 5, "body": "SQL injection.", '
        '"severity": "error", "category": "security"}], '
        '"summary": "SQL injection."}], '
        '"overall_summary": "One security issue.", "risk_level": "high", '
        '"dropped_count": 0}'
    )
    agent_response = '{"comments": [], "summary": "clean"}'

    def fake_invoke(messages, **kwargs):
        system = messages[0].content
        if "Critic" in system:
            return AIMessage(content='{"drop_indices": []}')
        if "Synthesizer" in system:
            return AIMessage(content=synth_response)
        return AIMessage(content=agent_response)

    mock = MagicMock()
    mock.with_retry.return_value = mock
    mock.invoke.side_effect = fake_invoke

    result = ReviewOrchestrator(llm=mock).run(sample_pr)

    assert result.total_comments == 1
    assert result.critic_dropped_count == 0


def test_critic_routes_opus_authored_comment_to_sonnet_critic(sample_pr):
    """security is opus-tier by default -> its comment must be critiqued by
    the critic_sonnet client, not critic_opus."""
    from arete_agents.orchestrator import ReviewOrchestrator

    synth_response = (
        '{"file_reviews": [{"path": "src/auth.py", "comments": '
        '[{"path": "src/auth.py", "line": 5, "body": "SQL injection.", '
        '"severity": "error", "category": "security"}], '
        '"summary": "SQL injection."}], '
        '"overall_summary": "One security issue.", "risk_level": "high", '
        '"dropped_count": 0}'
    )
    agent_llm = MagicMock()
    agent_llm.with_retry.return_value = agent_llm
    agent_llm.invoke.return_value = AIMessage(content='{"comments": [], "summary": "clean"}')

    synth_llm = MagicMock()
    synth_llm.with_retry.return_value = synth_llm
    synth_llm.invoke.return_value = AIMessage(content=synth_response)

    critic_opus_llm = MagicMock()
    critic_opus_llm.with_retry.return_value = critic_opus_llm

    critic_sonnet_llm = MagicMock()
    critic_sonnet_llm.with_retry.return_value = critic_sonnet_llm
    critic_sonnet_llm.invoke.return_value = AIMessage(content='{"drop_indices": []}')

    from arete_agents.llm.base import ROLE_KEYS
    llms = {role: agent_llm for role in ROLE_KEYS}
    llms["synthesizer"] = synth_llm
    llms["critic_opus"] = critic_opus_llm
    llms["critic_sonnet"] = critic_sonnet_llm

    ReviewOrchestrator(llm=llms).run(sample_pr)

    critic_sonnet_llm.invoke.assert_called_once()
    critic_opus_llm.invoke.assert_not_called()


def test_critic_call_failure_keeps_comments_uncritiqued(sample_pr):
    """Fail-open: if the critic LLM raises, the bucket's comments survive."""
    from arete_agents.orchestrator import ReviewOrchestrator

    synth_response = (
        '{"file_reviews": [{"path": "src/auth.py", "comments": '
        '[{"path": "src/auth.py", "line": 5, "body": "SQL injection.", '
        '"severity": "error", "category": "security"}], '
        '"summary": "SQL injection."}], '
        '"overall_summary": "One security issue.", "risk_level": "high", '
        '"dropped_count": 0}'
    )
    agent_response = '{"comments": [], "summary": "clean"}'

    def fake_invoke(messages, **kwargs):
        system = messages[0].content
        if "Critic" in system:
            raise RuntimeError("critic provider outage")
        if "Synthesizer" in system:
            return AIMessage(content=synth_response)
        return AIMessage(content=agent_response)

    mock = MagicMock()
    mock.with_retry.return_value = mock
    mock.invoke.side_effect = fake_invoke

    result = ReviewOrchestrator(llm=mock).run(sample_pr)

    assert result.total_comments == 1
    assert result.critic_dropped_count == 0


def test_orchestrator_accepts_explicit_tiers(sample_pr):
    """A caller may pass tiers= (e.g. role_tiers(settings)) to override the
    default category->tier mapping used for critic routing."""
    from arete_agents.orchestrator import ReviewOrchestrator

    synth_response = (
        '{"file_reviews": [{"path": "src/auth.py", "comments": '
        '[{"path": "src/auth.py", "line": 5, "body": "SQL injection.", '
        '"severity": "error", "category": "security"}], '
        '"summary": "SQL injection."}], '
        '"overall_summary": "One security issue.", "risk_level": "high", '
        '"dropped_count": 0}'
    )
    agent_llm = MagicMock()
    agent_llm.with_retry.return_value = agent_llm
    agent_llm.invoke.return_value = AIMessage(content='{"comments": [], "summary": "clean"}')

    synth_llm = MagicMock()
    synth_llm.with_retry.return_value = synth_llm
    synth_llm.invoke.return_value = AIMessage(content=synth_response)

    critic_opus_llm = MagicMock()
    critic_opus_llm.with_retry.return_value = critic_opus_llm
    critic_opus_llm.invoke.return_value = AIMessage(content='{"drop_indices": []}')

    critic_sonnet_llm = MagicMock()
    critic_sonnet_llm.with_retry.return_value = critic_sonnet_llm

    from arete_agents.llm.base import ROLE_KEYS
    llms = {role: agent_llm for role in ROLE_KEYS}
    llms["synthesizer"] = synth_llm
    llms["critic_opus"] = critic_opus_llm
    llms["critic_sonnet"] = critic_sonnet_llm

    # Override: security is sonnet-tier here, so its comment should go to
    # the OPPOSITE critic (critic_opus), not the default (critic_sonnet).
    overridden_tiers = {
        "security": "sonnet", "performance": "sonnet", "quality": "sonnet",
        "test_coverage": "sonnet", "deployment_safety": "sonnet",
        "business_logic": "sonnet",
    }

    ReviewOrchestrator(llm=llms, tiers=overridden_tiers).run(sample_pr)

    critic_opus_llm.invoke.assert_called_once()
    critic_sonnet_llm.invoke.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && uv run pytest tests/test_orchestrator.py -k critic -v`
Expected: FAIL — `TypeError` (unexpected `tiers` kwarg) or `AttributeError` (no `critic_dropped_count` behavior yet — Task 2 already added the field but nothing populates it from the orchestrator).

- [ ] **Step 3: Implement the wiring**

In `packages/agents/src/arete_agents/orchestrator.py`:

Add imports near the top:

```python
from arete_agents.critic import CriticAgent
```

Add a module-level constant near `MAX_RAW_REVIEWS_CHARS`:

```python
# Default category->tier mapping used for critic routing when the caller
# doesn't supply live settings-derived tiers via the `tiers` constructor
# param. Mirrors config.py's DEFAULT tier values for the 6 specialist
# categories (not necessarily the live/env-overridden values — pass
# tiers=role_tiers(settings) explicitly at the production call sites in
# server.py/cli.py to respect real per-installation overrides).
_DEFAULT_CATEGORY_TIERS: dict[str, str] = {
    "security": "opus",
    "performance": "sonnet",
    "quality": "sonnet",
    "test_coverage": "sonnet",
    "deployment_safety": "opus",
    "business_logic": "opus",
}
```

Change `ReviewOrchestrator.__init__`:

```python
    def __init__(
        self,
        llm: BaseChatModel | dict[str, BaseChatModel],
        tiers: dict[str, str] | None = None,
    ) -> None:
        # Accept either a single client (used for every role — the common case
        # in tests and simple callers) or a per-role dict from
        # get_llms_by_role() so each agent runs on its configured tier.
        if isinstance(llm, dict):
            self._llms = llm
        else:
            self._llms = {role: llm for role in ROLE_KEYS}
        self._agents = [
            SecurityAgent(self._llms["security"]),
            PerformanceAgent(self._llms["performance"]),
            QualityAgent(self._llms["quality"]),
            TestCoverageAgent(self._llms["test_coverage"]),
            DeploymentSafetyAgent(self._llms["deployment_safety"]),
            BusinessLogicAgent(self._llms["business_logic"]),
        ]
        self.synthesizer = SynthesizerAgent(self._llms["synthesizer"])
        self._critic_opus = CriticAgent(self._llms["critic_opus"])
        self._critic_sonnet = CriticAgent(self._llms["critic_sonnet"])
        self._category_tiers = tiers or _DEFAULT_CATEGORY_TIERS
        self.graph = self._build_graph()
```

Add a new method (place after `_synthesize_reviews`, before `run`):

```python
    def _apply_critic(self, pr: PRContext, result: ReviewResult) -> ReviewResult:
        """Independent second gate on the Synthesizer's output. Every
        surviving comment's category maps to its authoring tier; it is
        critiqued by the OPPOSITE tier's critic. Binary keep/drop only.
        Fails open on any critic error (see CriticAgent.critique)."""
        flat: list[tuple[int, int]] = [
            (fi, ci)
            for fi, fr in enumerate(result.file_reviews)
            for ci in range(len(fr.comments))
        ]
        if not flat:
            return result

        opus_authored: list[tuple[int, int]] = []
        sonnet_authored: list[tuple[int, int]] = []
        for fi, ci in flat:
            category = result.file_reviews[fi].comments[ci].category
            tier = self._category_tiers.get(category)
            if tier == "opus":
                opus_authored.append((fi, ci))
            elif tier == "sonnet":
                sonnet_authored.append((fi, ci))
            # else: unrecognized category -> kept as-is, uncritiqued.

        drop_keys: set[tuple[int, int]] = set()

        if opus_authored:
            comments = [result.file_reviews[fi].comments[ci] for fi, ci in opus_authored]
            dropped = self._critic_sonnet.critique(pr, comments)
            drop_keys |= {opus_authored[i] for i in dropped}

        if sonnet_authored:
            comments = [result.file_reviews[fi].comments[ci] for fi, ci in sonnet_authored]
            dropped = self._critic_opus.critique(pr, comments)
            drop_keys |= {sonnet_authored[i] for i in dropped}

        if not drop_keys:
            return result

        new_file_reviews = []
        for fi, fr in enumerate(result.file_reviews):
            kept = [c for ci, c in enumerate(fr.comments) if (fi, ci) not in drop_keys]
            new_file_reviews.append(FileReview(path=fr.path, comments=kept, summary=fr.summary))

        result.file_reviews = new_file_reviews
        result.critic_dropped_count = len(drop_keys)
        return result
```

Call it from `_synthesize_reviews`, right after `final_result` is obtained (from either the try block or the except fallback) and before the `analysis_status` failure check:

```python
    def _synthesize_reviews(self, state: GraphState) -> dict:
        pr = state["pr"]
        raw_reviews = state.get("raw_reviews", [])
        
        if not raw_reviews:
            return {"final_result": ReviewResult(
                pr_context=pr,
                file_reviews=[],
                overall_summary="No files changed.",
                risk_level="low",
            )}

        try:
            final_result = self.synthesizer.synthesize(pr, raw_reviews)
        except Exception as exc:
            logging.warning(
                f"Synthesizer failed: {exc}. Falling back to blind merge of "
                "already-gathered agent reviews (no agent LLM calls re-issued)."
            )
            final_result = _fallback_synthesize(pr, raw_reviews)

        final_result = self._apply_critic(pr, final_result)

        # "failed" only when every agent errored (total outage) — partial
        # failures still produced a real (if incomplete) review.
        if state.get("agent_failures", 0) > 0 and state.get("agent_successes", 0) == 0:
            final_result.analysis_status = "failed"
        return {"final_result": final_result}
```

(Only the new `final_result = self._apply_critic(pr, final_result)` line is added — everything else in this method is unchanged from the current file; do not otherwise restructure it.)

- [ ] **Step 4: Run the new tests**

Run: `cd packages/agents && uv run pytest tests/test_orchestrator.py -k critic -v`
Expected: PASS, all 6 new tests.

- [ ] **Step 5: Run the FULL existing test suite to confirm no regression**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -v`
Expected: all previously-passing tests still pass (baseline 155 + 1 skipped, plus this plan's new tests: 2 from Task 1, 1 from Task 2, 7 from Task 3, 6 from Task 4 = +16). If any existing cyclic_llm-based test fails, check whether the critic call consumed an unexpected item from that test's `side_effect` list — the design in this spec was verified against every existing test's exact call sequence during planning (see plan's design notes) and should not require changing any test outside Task 1 Step 2, but re-verify empirically here.

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add packages/agents/src/arete_agents/orchestrator.py packages/agents/tests/test_orchestrator.py
git commit -m "feat(agents): wire independent cross-tier critic stage into ReviewOrchestrator"
```

---

### Task 5: Wire live tiers into production call sites

**Files:**
- Modify: `packages/agents/src/arete_agents/server.py`
- Modify: `packages/agents/src/arete_agents/cli.py`

**Interfaces:**
- Consumes: `role_tiers` from `arete_agents.llm.base` (already imported as part of `get_llms_by_role` in both files — need to add `role_tiers` to the existing import).

- [ ] **Step 1: Update `server.py`**

Change the import line:
```python
from arete_agents.llm.base import get_llms_by_role
```
to:
```python
from arete_agents.llm.base import get_llms_by_role, role_tiers
```

Change:
```python
_llms = get_llms_by_role(_settings)
_orchestrator = ReviewOrchestrator(llm=_llms)
```
to:
```python
_llms = get_llms_by_role(_settings)
_orchestrator = ReviewOrchestrator(llm=_llms, tiers=role_tiers(_settings))
```

- [ ] **Step 2: Update `cli.py`**

Change the import line:
```python
from arete_agents.llm.base import get_llms_by_role
```
to:
```python
from arete_agents.llm.base import get_llms_by_role, role_tiers
```

Change:
```python
            pr = PRContext.model_validate(context_dict)
            orch = ReviewOrchestrator(llm=llms)
            result = orch.run(pr)
```
to:
```python
            pr = PRContext.model_validate(context_dict)
            orch = ReviewOrchestrator(llm=llms, tiers=role_tiers(settings))
            result = orch.run(pr)
```

- [ ] **Step 3: Run the full suite once more**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py`
Expected: no change from Task 4's final count — `server.py`/`cli.py` have no direct unit tests exercising this exact line in the existing suite (confirm by checking `test_e2e_smoke.py` isn't silently required — it's excluded per the standard baseline command).

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add packages/agents/src/arete_agents/server.py packages/agents/src/arete_agents/cli.py
git commit -m "feat(agents): use live per-installation tiers for critic routing in production"
```

---

## Final Verification

- [ ] **Full suite, one more time end-to-end**

```bash
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\agents"
uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -v
```
Expected: 155 + 1 skipped (baseline) + 16 new tests, all passing, 0 regressions.

- [ ] **Push to main** (per the repo's Phase 1 auto-merge policy): `git branch --show-current` (confirm `main`), then `git push origin main`.
