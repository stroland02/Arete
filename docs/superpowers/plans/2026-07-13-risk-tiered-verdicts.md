# Risk-Tiered Verdict & HITL Gate (SP4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give every `ReviewResult` an explicit, deterministic **verdict** — `pass` / `comment` / `review-required` / `blocked` — derived from `risk_level` and `analysis_status`, so not every finding is treated the same and higher-risk reviews get a stricter human-in-the-loop signal. Principle (à la ara, the researched competitor): **human PR discussion is not merge authorization** — the verdict is a recommendation surfaced to a human, never an auto-merge trigger.

**Architecture:** A new pure function `decide_verdict(result: ReviewResult) -> tuple[str, str]` in a new module `arete_agents/verdict.py`, called once from `ReviewOrchestrator.run()` right after `_apply_grounding` (grounding can drop comments, which is why the verdict is computed last — after risk-relevant composition is final). Two new fields on `ReviewResult`: `verdict` and `verdict_reason`, both defaulted for backward compatibility. No LLM call, no network — pure logic over data already on the result. Agents-lane only; the GitHub Checks-API surfacing of this verdict is an explicit follow-up, not built here (avoids the actively-edited webhook lane).

**Tech Stack:** Python 3.12, pydantic. Package lane: `packages/agents/src/arete_agents/` (`models/review.py`, `orchestrator.py`, new `verdict.py`) + tests. No changes to `packages/webhook`.

## Global Constraints

- **Deterministic, no LLM/network** — `decide_verdict` is a pure function of `ReviewResult` fields already present.
- **Verdict computed AFTER grounding** — `_apply_grounding` can change severity/finding composition by dropping comments; the verdict must reflect the final, post-grounding result.
- **Backward-compatible:** `verdict`/`verdict_reason` are new fields with defaults; every existing `ReviewResult(...)` construction (tests, eval harness, fallback paths) keeps working unmodified.
- **HITL principle:** `blocked` and `review-required` verdicts mean a human must act — nothing in this plan auto-merges, auto-approves, or auto-dismisses anything. This is advisory data on the result, consumed by a human/UI later.
- **Lane:** `packages/agents` only. Do NOT touch `packages/webhook`, `base.py`'s prompt/tool logic (SP3's neighboring lane), the Synthesizer's LLM prompt, or the Critic.
- Setup: `cd packages/agents && uv sync --extra dev`; `uv run pytest`.

---

### Task 1: `ReviewResult` gains `verdict` + `verdict_reason`

**Files:** Modify `packages/agents/src/arete_agents/models/review.py`; Test `packages/agents/tests/test_models.py`

**Change:**
```python
class ReviewResult(BaseModel):
    ...
    # Deterministic, non-LLM risk-tiered gate (see verdict.decide_verdict).
    # "pass"/"comment" are informational; "review-required"/"blocked" mean
    # a human must act before merge — this field is advisory data only,
    # never an auto-merge/auto-dismiss signal (human discussion is not
    # merge authorization).
    verdict: Literal["pass", "comment", "review-required", "blocked"] = "pass"
    verdict_reason: str = ""
```

- [ ] **Step 1:** Add a test constructing an existing-style `ReviewResult(...)` (no `verdict` args, matching how existing tests build it) and asserting it still validates with `verdict == "pass"` and `verdict_reason == ""` by default. Run `uv run pytest tests/test_models.py -v` → FAIL (fields don't exist yet, so the assertion on defaults fails / AttributeError).
- [ ] **Step 2:** Add the two fields exactly as above. Run → PASS.
- [ ] **Step 3:** Commit: `feat(agents): add verdict/verdict_reason fields to ReviewResult`.

### Task 2: `verdict.py` — deterministic policy

**Files:** Create `packages/agents/src/arete_agents/verdict.py`; Test `packages/agents/tests/test_verdict.py`

**Policy (exact, in this precedence order):**
```python
from arete_agents.models.review import ReviewResult


def decide_verdict(result: ReviewResult) -> tuple[str, str]:
    """Deterministic, non-LLM risk-tiered verdict. Pure function of fields
    already on ReviewResult. Precedence: a failed analysis always blocks
    (nothing was actually reviewed), regardless of the risk_level the
    fallback path may have defaulted to."""
    if result.analysis_status == "failed":
        return (
            "blocked",
            "Automated review could not be completed (all agents failed); "
            "human review required before merge.",
        )
    if result.risk_level == "critical":
        return (
            "blocked",
            "Critical-severity findings require human sign-off before merge.",
        )
    if result.risk_level == "high":
        return (
            "review-required",
            "High-risk findings require human review before merge.",
        )
    if result.risk_level == "medium":
        return (
            "comment",
            "Medium-risk findings noted; advisory, not blocking.",
        )
    return ("pass", "No blocking issues found.")
```

- [ ] **Step 1:** Write `tests/test_verdict.py` with one case per branch: `analysis_status="failed"` (any risk_level) → `blocked` + the failed-specific reason (assert this wins even if `risk_level="low"`, proving precedence); `risk_level="critical"` → `blocked`; `"high"` → `review-required`; `"medium"` → `comment`; `"low"` → `pass`. Build minimal `ReviewResult` fixtures (empty `file_reviews`, a stub `pr_context`) matching the existing test-construction style in `test_models.py`/`conftest.py`. Run → FAIL (`ModuleNotFoundError`).
- [ ] **Step 2:** Implement `verdict.py` exactly as above. Run `uv run pytest tests/test_verdict.py -v` → PASS.
- [ ] **Step 3:** Commit: `feat(agents): deterministic risk-tiered verdict policy`.

### Task 3: Wire into the orchestrator, after grounding

**Files:** Modify `packages/agents/src/arete_agents/orchestrator.py`; Test `packages/agents/tests/test_orchestrator.py`

**Change:** in the node that calls `_apply_critic`/`_apply_grounding` (the block ending `final_result = self._apply_grounding(pr, final_result)`), add immediately after:
```python
        final_result = self._apply_grounding(pr, final_result)

        # "failed" only when every agent errored (total outage) — partial
        # failures still produced a real (if incomplete) review.
        if state.get("agent_failures", 0) > 0 and state.get("agent_successes", 0) == 0:
            final_result.analysis_status = "failed"

        from arete_agents.verdict import decide_verdict
        final_result.verdict, final_result.verdict_reason = decide_verdict(final_result)

        return {"final_result": final_result}
```
Note the verdict decision is placed AFTER the `analysis_status = "failed"` assignment (not before) — `decide_verdict` must see the final `analysis_status`, not a stale value from before the failure check.

- [ ] **Step 1:** Write a test in `test_orchestrator.py` (matching the existing fake-LLM/`cyclic_llm`-style orchestrator tests) for: (a) a normal run whose synthesized `risk_level` is e.g. `"high"` → assert `final_result.verdict == "review-required"`; (b) a total-agent-failure run (all agent calls raise, matching however the existing "failed" test triggers `agent_failures>0, agent_successes==0`) → assert `final_result.verdict == "blocked"` and the reason mentions the review could not be completed (proving the placement AFTER the failed-status assignment is correct). Run → FAIL (verdict not set, defaults to `"pass"`).
- [ ] **Step 2:** Apply the wiring. Run `uv run pytest tests/test_orchestrator.py -v` → PASS.
- [ ] **Step 3:** Run the FULL suite `uv run pytest -q` — green, no regressions (existing orchestrator/eval/critic/grounding tests unaffected since `verdict` defaults to `"pass"` when unset by older code paths).
- [ ] **Step 4:** Commit: `feat(agents): wire risk-tiered verdict into ReviewOrchestrator.run()`.

---

## Self-Review

- **Coverage:** field addition → T1; policy → T2; wiring → T3. Matches the approved "agents-lane verdict only" scope — no webhook/Checks-API changes. ✅
- **Type consistency:** `decide_verdict(result: ReviewResult) -> tuple[str, str]` (T2) consumed by `orchestrator.py` (T3) via `final_result.verdict, final_result.verdict_reason = decide_verdict(final_result)`; fields it reads (`analysis_status`, `risk_level`) both exist on `ReviewResult` already. ✅
- **Backward compat:** T1 fields defaulted; no existing `ReviewResult(...)` call site needs updating. ✅
- **HITL principle:** `blocked`/`review-required` are advisory only; nothing in this plan triggers merge/dismiss actions — verified by scope (no webhook touch). ✅
- **No placeholders:** every task has concrete code + exact test cases + commands. ✅
- **Ordering correctness:** T3 explicitly places the verdict call after BOTH `_apply_grounding` and the `analysis_status = "failed"` assignment, with a test proving the failed-precedence case. ✅
