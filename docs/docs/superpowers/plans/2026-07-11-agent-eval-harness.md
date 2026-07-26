# Areté Agent Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline, deterministic-capable harness that measures each review agent's Precision / Recall / F1 / false-positive rate against a hand-authored golden fixture set.

**Architecture:** A new additive module `arete_agents.eval` runs the real review agents (the "finder") over JSON fixtures with planted defects, matches each produced comment to a defect via a cheap deterministic localization gate followed by an optional cross-model LLM description judge, then scores TP/FP/FN into per-agent and overall metrics with a JSON/Markdown report and a CLI regression gate. Nothing in the live `review_file` path or orchestrator graph changes.

**Tech Stack:** Python 3.12, Pydantic v2, LangChain core (`BaseChatModel`), existing `arete_agents` models and LLM builders, `uv` + `pytest`, `argparse` (stdlib) for the CLI.

## Global Constraints

- **Lane:** touch only `packages/agents/**` and `docs/**`. Do NOT modify `packages/webhook/**` or `packages/dashboard/**`.
- **Additive-only:** no edits to `agents/base.py`, any `agents/*.py`, `orchestrator.py`, `models/pr.py`, or `models/review.py`. `config.py` may only gain new optional fields with defaults that preserve current behavior.
- **Baseline:** the existing pytest suite is **29 passed**. It must remain green after every task. New tests add to that count.
- **No new heavy dependencies.** Use only what `pyproject.toml` already declares plus the Python stdlib.
- **Module path:** all new source lives under `packages/agents/src/arete_agents/eval/`. Data lives under `packages/agents/eval/`. Tests live under `packages/agents/tests/` (repo uses `testpaths = ["tests"]`).
- **Agent names are fixed** and equal `ReviewComment.category`: `security`, `performance`, `quality`, `test_coverage`, `deployment_safety`, `business_logic`.
- **Run commands** from the `packages/agents` directory unless noted. Test invocation: `uv run pytest <path> -v`.
- **Localization window default = 3.** **F1 regression threshold default = 0.05.**

---

### Task 1: Eval data models

**Files:**
- Create: `packages/agents/src/arete_agents/eval/__init__.py`
- Create: `packages/agents/src/arete_agents/eval/models.py`
- Test: `packages/agents/tests/test_eval_models.py`

**Interfaces:**
- Consumes: `PRContext` from `arete_agents.models.pr`; `ReviewComment` from `arete_agents.models.review`.
- Produces:
  - `PlantedDefect(id: str, path: str, line: int, target_agent: str, description: str, severity: Literal["info","warning","error"])`
  - `EvalFixture(id: str, pr: PRContext, planted_defects: list[PlantedDefect] = [], clean: bool = False)`
  - `MatchResult(defect_id: str | None, comment: ReviewComment, localization_ok: bool, description_ok: bool | None)`
  - `AgentScore(agent: str, tp: int, fp: int, fn: int, precision: float, recall: float, f1: float, fp_rate: float)`
  - `FixtureAgentResult(fixture_id: str, agent: str, relevant_defects: list[PlantedDefect], comments: list[ReviewComment], match_results: list[MatchResult])`
  - `EvalReport(per_agent: list[AgentScore], overall: AgentScore, misses: list[PlantedDefect], false_positives: list[ReviewComment], meta: dict[str, str] = {})`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/tests/test_eval_models.py` with exactly this content:

```python
from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import ReviewComment
from arete_agents.eval.models import (
    AgentScore,
    EvalFixture,
    FixtureAgentResult,
    MatchResult,
    PlantedDefect,
)


def _pr() -> PRContext:
    return PRContext(
        repo="acme/api",
        pr_number=1,
        title="t",
        description="d",
        files=[FileChange(path="a.py", patch="+x", additions=1, deletions=0)],
    )


def test_planted_defect_fields():
    d = PlantedDefect(
        id="sqli-001",
        path="a.py",
        line=5,
        target_agent="security",
        description="SQL injection",
        severity="error",
    )
    assert d.id == "sqli-001"
    assert d.target_agent == "security"


def test_eval_fixture_defaults():
    f = EvalFixture(id="f1", pr=_pr())
    assert f.planted_defects == []
    assert f.clean is False


def test_match_result_allows_none_defect():
    c = ReviewComment(path="a.py", line=5, body="b", severity="error", category="security")
    m = MatchResult(defect_id=None, comment=c, localization_ok=False, description_ok=None)
    assert m.defect_id is None


def test_agent_score_and_report_container():
    score = AgentScore(
        agent="security", tp=1, fp=0, fn=0,
        precision=1.0, recall=1.0, f1=1.0, fp_rate=0.0,
    )
    far = FixtureAgentResult(
        fixture_id="f1", agent="security",
        relevant_defects=[], comments=[], match_results=[],
    )
    assert score.f1 == 1.0
    assert far.fixture_id == "f1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_eval_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arete_agents.eval'`

- [ ] **Step 3: Create the package and models**

Create `packages/agents/src/arete_agents/eval/__init__.py` as an empty file (zero bytes is fine).

Create `packages/agents/src/arete_agents/eval/models.py`:

```python
from typing import Literal

from pydantic import BaseModel, Field

from arete_agents.models.pr import PRContext
from arete_agents.models.review import ReviewComment


class PlantedDefect(BaseModel):
    id: str
    path: str
    line: int
    target_agent: str
    description: str
    severity: Literal["info", "warning", "error"]


class EvalFixture(BaseModel):
    id: str
    pr: PRContext
    planted_defects: list[PlantedDefect] = Field(default_factory=list)
    clean: bool = False


class MatchResult(BaseModel):
    defect_id: str | None
    comment: ReviewComment
    localization_ok: bool
    description_ok: bool | None


class AgentScore(BaseModel):
    agent: str
    tp: int
    fp: int
    fn: int
    precision: float
    recall: float
    f1: float
    fp_rate: float


class FixtureAgentResult(BaseModel):
    fixture_id: str
    agent: str
    relevant_defects: list[PlantedDefect]
    comments: list[ReviewComment]
    match_results: list[MatchResult]


class EvalReport(BaseModel):
    per_agent: list[AgentScore]
    overall: AgentScore
    misses: list[PlantedDefect]
    false_positives: list[ReviewComment]
    meta: dict[str, str] = Field(default_factory=dict)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_eval_models.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/eval/__init__.py packages/agents/src/arete_agents/eval/models.py packages/agents/tests/test_eval_models.py
git commit -m "feat(eval): add eval harness data models"
```

---

### Task 2: Scorer (P/R/F1/FP-rate math + baseline compare)

**Files:**
- Create: `packages/agents/src/arete_agents/eval/scorer.py`
- Test: `packages/agents/tests/test_eval_scorer.py`

**Interfaces:**
- Consumes: `PlantedDefect`, `ReviewComment`, `MatchResult`, `AgentScore`, `FixtureAgentResult` from Task 1.
- Produces:
  - `score_agent(agent: str, results: list[FixtureAgentResult]) -> AgentScore`
  - `aggregate_overall(scores: list[AgentScore]) -> AgentScore`
  - `collect_misses(results: list[FixtureAgentResult]) -> list[PlantedDefect]`
  - `collect_false_positives(results: list[FixtureAgentResult]) -> list[ReviewComment]`
  - `f1_regressed(current: float, baseline: float, threshold: float = 0.05) -> bool` (True when `current < baseline - threshold`)
- A `MatchResult` counts as a **confirmed defect match** iff `defect_id is not None`. A `MatchResult` with `defect_id is None` is a **false positive comment**.

- [ ] **Step 1: Write the failing test**

Create `packages/agents/tests/test_eval_scorer.py`:

```python
from arete_agents.models.review import ReviewComment
from arete_agents.eval.models import (
    AgentScore,
    FixtureAgentResult,
    MatchResult,
    PlantedDefect,
)
from arete_agents.eval.scorer import (
    aggregate_overall,
    collect_false_positives,
    collect_misses,
    f1_regressed,
    score_agent,
)


def _defect(did: str, agent: str = "security") -> PlantedDefect:
    return PlantedDefect(
        id=did, path="a.py", line=5, target_agent=agent,
        description="d", severity="error",
    )


def _comment(agent: str = "security") -> ReviewComment:
    return ReviewComment(path="a.py", line=5, body="b", severity="error", category=agent)


def _tp_result() -> FixtureAgentResult:
    d = _defect("d1")
    c = _comment()
    return FixtureAgentResult(
        fixture_id="f1", agent="security", relevant_defects=[d], comments=[c],
        match_results=[MatchResult(defect_id="d1", comment=c, localization_ok=True, description_ok=True)],
    )


def _fp_result() -> FixtureAgentResult:
    c = _comment()
    return FixtureAgentResult(
        fixture_id="f2", agent="security", relevant_defects=[], comments=[c],
        match_results=[MatchResult(defect_id=None, comment=c, localization_ok=False, description_ok=None)],
    )


def _fn_result() -> FixtureAgentResult:
    d = _defect("d2")
    return FixtureAgentResult(
        fixture_id="f3", agent="security", relevant_defects=[d], comments=[], match_results=[],
    )


def test_perfect_true_positive():
    s = score_agent("security", [_tp_result()])
    assert (s.tp, s.fp, s.fn) == (1, 0, 0)
    assert s.precision == 1.0 and s.recall == 1.0 and s.f1 == 1.0
    assert s.fp_rate == 0.0


def test_false_positive_only():
    s = score_agent("security", [_fp_result()])
    assert (s.tp, s.fp, s.fn) == (0, 1, 0)
    assert s.precision == 0.0
    assert s.fp_rate == 1.0


def test_false_negative_only():
    s = score_agent("security", [_fn_result()])
    assert (s.tp, s.fp, s.fn) == (0, 0, 1)
    assert s.recall == 0.0


def test_mixed_prf1():
    s = score_agent("security", [_tp_result(), _fp_result(), _fn_result()])
    assert (s.tp, s.fp, s.fn) == (1, 1, 1)
    assert s.precision == 0.5
    assert s.recall == 0.5
    assert s.f1 == 0.5


def test_duplicate_confirm_is_single_tp_not_fp():
    d = _defect("d1")
    c1, c2 = _comment(), _comment()
    r = FixtureAgentResult(
        fixture_id="f1", agent="security", relevant_defects=[d], comments=[c1, c2],
        match_results=[
            MatchResult(defect_id="d1", comment=c1, localization_ok=True, description_ok=True),
            MatchResult(defect_id="d1", comment=c2, localization_ok=True, description_ok=True),
        ],
    )
    s = score_agent("security", [r])
    assert (s.tp, s.fp, s.fn) == (1, 0, 0)


def test_zero_division_guard_empty():
    s = score_agent("security", [])
    assert (s.tp, s.fp, s.fn) == (0, 0, 0)
    assert s.precision == 0.0 and s.recall == 0.0 and s.f1 == 0.0 and s.fp_rate == 0.0


def test_aggregate_overall_sums_counts():
    a = AgentScore(agent="security", tp=1, fp=1, fn=1, precision=0.5, recall=0.5, f1=0.5, fp_rate=0.5)
    b = AgentScore(agent="quality", tp=3, fp=0, fn=1, precision=1.0, recall=0.75, f1=0.857, fp_rate=0.0)
    o = aggregate_overall([a, b])
    assert o.agent == "overall"
    assert (o.tp, o.fp, o.fn) == (4, 1, 2)
    assert round(o.precision, 3) == 0.8
    assert round(o.recall, 3) == 0.667


def test_collect_misses_and_fps():
    results = [_tp_result(), _fp_result(), _fn_result()]
    misses = collect_misses(results)
    fps = collect_false_positives(results)
    assert [m.id for m in misses] == ["d2"]
    assert len(fps) == 1


def test_f1_regressed():
    assert f1_regressed(0.50, 0.60, 0.05) is True
    assert f1_regressed(0.56, 0.60, 0.05) is False
    assert f1_regressed(0.60, 0.60, 0.05) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_eval_scorer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arete_agents.eval.scorer'`

- [ ] **Step 3: Write the scorer**

Create `packages/agents/src/arete_agents/eval/scorer.py`:

```python
from arete_agents.models.review import ReviewComment
from arete_agents.eval.models import (
    AgentScore,
    FixtureAgentResult,
    PlantedDefect,
)


def _safe_div(num: float, den: float) -> float:
    return num / den if den else 0.0


def _prf(tp: int, fp: int, fn: int) -> tuple[float, float, float, float]:
    precision = _safe_div(tp, tp + fp)
    recall = _safe_div(tp, tp + fn)
    f1 = _safe_div(2 * precision * recall, precision + recall)
    fp_rate = _safe_div(fp, tp + fp)
    return precision, recall, f1, fp_rate


def score_agent(agent: str, results: list[FixtureAgentResult]) -> AgentScore:
    tp = fp = fn = 0
    for r in results:
        confirmed_ids = {
            m.defect_id for m in r.match_results if m.defect_id is not None
        }
        fp += sum(1 for m in r.match_results if m.defect_id is None)
        relevant_ids = {d.id for d in r.relevant_defects}
        tp += len(relevant_ids & confirmed_ids)
        fn += len(relevant_ids - confirmed_ids)
    precision, recall, f1, fp_rate = _prf(tp, fp, fn)
    return AgentScore(
        agent=agent, tp=tp, fp=fp, fn=fn,
        precision=precision, recall=recall, f1=f1, fp_rate=fp_rate,
    )


def aggregate_overall(scores: list[AgentScore]) -> AgentScore:
    tp = sum(s.tp for s in scores)
    fp = sum(s.fp for s in scores)
    fn = sum(s.fn for s in scores)
    precision, recall, f1, fp_rate = _prf(tp, fp, fn)
    return AgentScore(
        agent="overall", tp=tp, fp=fp, fn=fn,
        precision=precision, recall=recall, f1=f1, fp_rate=fp_rate,
    )


def collect_misses(results: list[FixtureAgentResult]) -> list[PlantedDefect]:
    misses: list[PlantedDefect] = []
    for r in results:
        confirmed_ids = {
            m.defect_id for m in r.match_results if m.defect_id is not None
        }
        misses.extend(d for d in r.relevant_defects if d.id not in confirmed_ids)
    return misses


def collect_false_positives(results: list[FixtureAgentResult]) -> list[ReviewComment]:
    fps: list[ReviewComment] = []
    for r in results:
        fps.extend(m.comment for m in r.match_results if m.defect_id is None)
    return fps


def f1_regressed(current: float, baseline: float, threshold: float = 0.05) -> bool:
    return current < baseline - threshold
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_eval_scorer.py -v`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/eval/scorer.py packages/agents/tests/test_eval_scorer.py
git commit -m "feat(eval): add scorer for P/R/F1 and regression gate"
```

---

### Task 3: Matcher (localization gate + description judge)

**Files:**
- Create: `packages/agents/src/arete_agents/eval/matcher.py`
- Test: `packages/agents/tests/test_eval_matcher.py`

**Interfaces:**
- Consumes: `PlantedDefect`, `ReviewComment`, `MatchResult` from Task 1; `build_gemini_llm`, `build_anthropic_llm` from `arete_agents.llm.*` (imported lazily inside `build_judge`).
- Produces:
  - `DEFAULT_WINDOW = 3`
  - `localization_candidates(comment: ReviewComment, defects: list[PlantedDefect], window: int = DEFAULT_WINDOW) -> list[PlantedDefect]` — returns defects with `path ==`, `abs(line diff) <= window`, `category == target_agent`.
  - Judge protocol: any object with `confirm(comment_body: str, defect_description: str) -> bool`.
  - `StubJudge` — `confirm(...)` always returns `True` (localization-only mode; `description_ok` recorded as `None`).
  - `LLMJudge(llm)` — calls the model, returns bool from a yes/no answer.
  - `build_judge(mode: str, gemini_api_key: str = "", anthropic_api_key: str = "") -> tuple[object, bool]` — returns `(judge, is_stub)`; `mode` in `{"stub","gemini","anthropic"}`.
  - `match_comments(comments: list[ReviewComment], defects: list[PlantedDefect], judge, is_stub: bool, window: int = DEFAULT_WINDOW) -> list[MatchResult]`
- Matching rule per comment: compute candidates. If none → `MatchResult(defect_id=None, localization_ok=False, description_ok=None)`. If candidates exist and `is_stub` → confirm the first candidate with `description_ok=None`. Else run `judge.confirm` on each candidate in order; first `True` → confirmed with `description_ok=True`; if all `False` → `MatchResult(defect_id=None, localization_ok=True, description_ok=False)`.

- [ ] **Step 1: Write the failing test**

Create `packages/agents/tests/test_eval_matcher.py`:

```python
from arete_agents.models.review import ReviewComment
from arete_agents.eval.models import PlantedDefect
from arete_agents.eval.matcher import (
    DEFAULT_WINDOW,
    StubJudge,
    build_judge,
    localization_candidates,
    match_comments,
)


def _defect(line: int = 5, agent: str = "security", path: str = "a.py") -> PlantedDefect:
    return PlantedDefect(
        id="d1", path=path, line=line, target_agent=agent,
        description="SQL injection via string formatting", severity="error",
    )


def _comment(line: int = 5, category: str = "security", path: str = "a.py") -> ReviewComment:
    return ReviewComment(path=path, line=line, body="SQLi risk", severity="error", category=category)


def test_exact_localization_matches():
    assert localization_candidates(_comment(5), [_defect(5)]) != []


def test_within_window_matches():
    assert localization_candidates(_comment(8), [_defect(5)], window=3) != []


def test_out_of_window_no_match():
    assert localization_candidates(_comment(9), [_defect(5)], window=3) == []


def test_wrong_category_no_match():
    assert localization_candidates(_comment(5, category="performance"), [_defect(5)]) == []


def test_wrong_path_no_match():
    assert localization_candidates(_comment(5, path="b.py"), [_defect(5, path="a.py")]) == []


def test_default_window_is_three():
    assert DEFAULT_WINDOW == 3


def test_stub_match_produces_tp():
    results = match_comments([_comment(6)], [_defect(5)], StubJudge(), is_stub=True)
    assert len(results) == 1
    assert results[0].defect_id == "d1"
    assert results[0].localization_ok is True
    assert results[0].description_ok is None


def test_unlocalized_comment_is_fp():
    results = match_comments([_comment(50)], [_defect(5)], StubJudge(), is_stub=True)
    assert results[0].defect_id is None
    assert results[0].localization_ok is False


def test_llm_judge_rejection_becomes_fp():
    class NoJudge:
        def confirm(self, comment_body: str, defect_description: str) -> bool:
            return False

    results = match_comments([_comment(5)], [_defect(5)], NoJudge(), is_stub=False)
    assert results[0].defect_id is None
    assert results[0].localization_ok is True
    assert results[0].description_ok is False


def test_llm_judge_confirmation_is_tp():
    class YesJudge:
        def confirm(self, comment_body: str, defect_description: str) -> bool:
            return True

    results = match_comments([_comment(5)], [_defect(5)], YesJudge(), is_stub=False)
    assert results[0].defect_id == "d1"
    assert results[0].description_ok is True


def test_build_judge_stub():
    judge, is_stub = build_judge("stub")
    assert is_stub is True
    assert judge.confirm("x", "y") is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_eval_matcher.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arete_agents.eval.matcher'`

- [ ] **Step 3: Write the matcher**

Create `packages/agents/src/arete_agents/eval/matcher.py`:

```python
from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.models.review import ReviewComment
from arete_agents.eval.models import MatchResult, PlantedDefect

DEFAULT_WINDOW = 3

_JUDGE_SYSTEM = (
    "You are a strict evaluation judge. You are given a REVIEWER COMMENT and a "
    "GROUND-TRUTH DEFECT description. Answer with a single word: YES if the "
    "comment identifies the same underlying defect as the ground truth, "
    "otherwise NO. Do not explain."
)


def localization_candidates(
    comment: ReviewComment,
    defects: list[PlantedDefect],
    window: int = DEFAULT_WINDOW,
) -> list[PlantedDefect]:
    return [
        d
        for d in defects
        if comment.path == d.path
        and comment.category == d.target_agent
        and abs(comment.line - d.line) <= window
    ]


class StubJudge:
    def confirm(self, comment_body: str, defect_description: str) -> bool:
        return True


class LLMJudge:
    def __init__(self, llm) -> None:
        self._llm = llm

    def confirm(self, comment_body: str, defect_description: str) -> bool:
        messages = [
            SystemMessage(content=_JUDGE_SYSTEM),
            HumanMessage(
                content=(
                    f"REVIEWER COMMENT:\n{comment_body}\n\n"
                    f"GROUND-TRUTH DEFECT:\n{defect_description}\n\n"
                    "Same defect? YES or NO."
                )
            ),
        ]
        llm_with_retry = self._llm.with_retry(stop_after_attempt=2)
        response = llm_with_retry.invoke(messages)
        raw = response.content if isinstance(response.content, str) else ""
        return "yes" in raw.strip().lower()[:5]


def build_judge(
    mode: str,
    gemini_api_key: str = "",
    anthropic_api_key: str = "",
) -> tuple[object, bool]:
    if mode == "stub":
        return StubJudge(), True
    if mode == "gemini":
        from arete_agents.llm.gemini import build_gemini_llm

        return LLMJudge(build_gemini_llm(gemini_api_key)), False
    if mode == "anthropic":
        from arete_agents.llm.anthropic import build_anthropic_llm

        return LLMJudge(build_anthropic_llm(anthropic_api_key)), False
    raise ValueError(f"Unknown judge mode: {mode!r}")


def match_comments(
    comments: list[ReviewComment],
    defects: list[PlantedDefect],
    judge,
    is_stub: bool,
    window: int = DEFAULT_WINDOW,
) -> list[MatchResult]:
    results: list[MatchResult] = []
    for comment in comments:
        candidates = localization_candidates(comment, defects, window)
        if not candidates:
            results.append(
                MatchResult(
                    defect_id=None, comment=comment,
                    localization_ok=False, description_ok=None,
                )
            )
            continue
        if is_stub:
            results.append(
                MatchResult(
                    defect_id=candidates[0].id, comment=comment,
                    localization_ok=True, description_ok=None,
                )
            )
            continue
        confirmed = None
        for cand in candidates:
            if judge.confirm(comment.body, cand.description):
                confirmed = cand
                break
        if confirmed is not None:
            results.append(
                MatchResult(
                    defect_id=confirmed.id, comment=comment,
                    localization_ok=True, description_ok=True,
                )
            )
        else:
            results.append(
                MatchResult(
                    defect_id=None, comment=comment,
                    localization_ok=True, description_ok=False,
                )
            )
    return results
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_eval_matcher.py -v`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/eval/matcher.py packages/agents/tests/test_eval_matcher.py
git commit -m "feat(eval): add hybrid localization + description-judge matcher"
```

---

### Task 4: Fixture loader

**Files:**
- Create: `packages/agents/src/arete_agents/eval/loader.py`
- Test: `packages/agents/tests/test_eval_loader.py`

**Interfaces:**
- Consumes: `EvalFixture` from Task 1.
- Produces:
  - `load_fixture(path: Path) -> EvalFixture`
  - `load_fixtures(directory: Path) -> list[EvalFixture]` — loads every `*.json` in `directory` sorted by filename; raises `ValueError` (with the filename) on a malformed file; raises `FileNotFoundError` if `directory` does not exist.

- [ ] **Step 1: Write the failing test**

Create `packages/agents/tests/test_eval_loader.py`:

```python
import json

import pytest

from arete_agents.eval.loader import load_fixtures


_VALID = {
    "id": "sec-sqli",
    "pr": {
        "repo": "acme/api",
        "pr_number": 1,
        "title": "t",
        "description": "d",
        "files": [{"path": "a.py", "patch": "+x", "additions": 1, "deletions": 0}],
    },
    "planted_defects": [
        {
            "id": "sqli-001", "path": "a.py", "line": 5,
            "target_agent": "security", "description": "SQL injection",
            "severity": "error",
        }
    ],
    "clean": False,
}


def test_loads_valid_fixture(tmp_path):
    (tmp_path / "sec.json").write_text(json.dumps(_VALID), encoding="utf-8")
    fixtures = load_fixtures(tmp_path)
    assert len(fixtures) == 1
    assert fixtures[0].id == "sec-sqli"
    assert fixtures[0].planted_defects[0].target_agent == "security"


def test_sorted_by_filename(tmp_path):
    (tmp_path / "b.json").write_text(json.dumps({**_VALID, "id": "b"}), encoding="utf-8")
    (tmp_path / "a.json").write_text(json.dumps({**_VALID, "id": "a"}), encoding="utf-8")
    fixtures = load_fixtures(tmp_path)
    assert [f.id for f in fixtures] == ["a", "b"]


def test_malformed_file_raises_with_name(tmp_path):
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError) as exc:
        load_fixtures(tmp_path)
    assert "bad.json" in str(exc.value)


def test_missing_directory_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_fixtures(tmp_path / "nope")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_eval_loader.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arete_agents.eval.loader'`

- [ ] **Step 3: Write the loader**

Create `packages/agents/src/arete_agents/eval/loader.py`:

```python
import json
from pathlib import Path

from arete_agents.eval.models import EvalFixture


def load_fixture(path: Path) -> EvalFixture:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return EvalFixture.model_validate(data)
    except Exception as exc:
        raise ValueError(f"Invalid fixture {path.name}: {exc}") from exc


def load_fixtures(directory: Path) -> list[EvalFixture]:
    if not directory.exists():
        raise FileNotFoundError(f"Fixtures directory not found: {directory}")
    return [load_fixture(p) for p in sorted(directory.glob("*.json"))]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_eval_loader.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/eval/loader.py packages/agents/tests/test_eval_loader.py
git commit -m "feat(eval): add fixture loader with validation"
```

---

### Task 5: Runner (execute agents over fixtures + match)

**Files:**
- Create: `packages/agents/src/arete_agents/eval/runner.py`
- Test: `packages/agents/tests/test_eval_runner.py`

**Interfaces:**
- Consumes: `EvalFixture`, `FixtureAgentResult`, `PlantedDefect` from Task 1; `match_comments`, `DEFAULT_WINDOW` from Task 3.
- Produces:
  - `AGENT_NAMES: list[str]` = `["security","performance","quality","test_coverage","deployment_safety","business_logic"]`
  - `build_agents(llm) -> list` — instantiates the six agents with the finder `llm`.
  - `run_fixture(fixture, agents, judge, is_stub, window=DEFAULT_WINDOW) -> list[FixtureAgentResult]` — for each agent: run `agent.review_file` over every file in `fixture.pr.files`, collect comments, compute `relevant_defects` (`target_agent == agent.agent_name`), match, and build one `FixtureAgentResult`.
  - `run_all(fixtures, agents, judge, is_stub, window=DEFAULT_WINDOW) -> list[FixtureAgentResult]` — flattens `run_fixture` across all fixtures.

- [ ] **Step 1: Write the failing test**

Create `packages/agents/tests/test_eval_runner.py`:

```python
from unittest.mock import MagicMock

from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewComment
from arete_agents.eval.models import EvalFixture, PlantedDefect
from arete_agents.eval.matcher import StubJudge
from arete_agents.eval.runner import AGENT_NAMES, run_fixture


def _fixture(defect_agent: str = "security") -> EvalFixture:
    pr = PRContext(
        repo="acme/api", pr_number=1, title="t", description="d",
        files=[FileChange(path="a.py", patch="+x", additions=1, deletions=0)],
    )
    return EvalFixture(
        id="f1", pr=pr,
        planted_defects=[PlantedDefect(
            id="d1", path="a.py", line=5, target_agent=defect_agent,
            description="SQL injection", severity="error",
        )],
    )


def _agents_with_security_hit() -> list:
    agents = []
    for name in AGENT_NAMES:
        a = MagicMock()
        a.agent_name = name
        if name == "security":
            a.review_file.return_value = FileReview(
                path="a.py",
                comments=[ReviewComment(path="a.py", line=5, body="SQLi", severity="error", category="security")],
                summary="s",
            )
        else:
            a.review_file.return_value = FileReview(path="a.py", comments=[], summary="")
        agents.append(a)
    return agents


def test_agent_names_are_the_six():
    assert AGENT_NAMES == [
        "security", "performance", "quality",
        "test_coverage", "deployment_safety", "business_logic",
    ]


def test_run_fixture_records_tp_for_matching_agent():
    agents = _agents_with_security_hit()
    results = run_fixture(_fixture(), agents, StubJudge(), is_stub=True)
    by_agent = {r.agent: r for r in results}
    sec = by_agent["security"]
    assert len(sec.relevant_defects) == 1
    assert any(m.defect_id == "d1" for m in sec.match_results)
    assert by_agent["quality"].relevant_defects == []
    assert by_agent["quality"].comments == []


def test_run_fixture_survives_agent_exception():
    agents = []
    for name in AGENT_NAMES:
        a = MagicMock()
        a.agent_name = name
        if name == "security":
            a.review_file.side_effect = RuntimeError("boom")
        else:
            a.review_file.return_value = FileReview(path="a.py", comments=[], summary="")
        agents.append(a)

    results = run_fixture(_fixture(), agents, StubJudge(), is_stub=True)
    by_agent = {r.agent: r for r in results}
    assert by_agent["security"].comments == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_eval_runner.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arete_agents.eval.runner'`

- [ ] **Step 3: Write the runner**

Create `packages/agents/src/arete_agents/eval/runner.py`:

```python
from arete_agents.agents.business_logic import BusinessLogicAgent
from arete_agents.agents.deployment_safety import DeploymentSafetyAgent
from arete_agents.agents.performance import PerformanceAgent
from arete_agents.agents.quality import QualityAgent
from arete_agents.agents.security import SecurityAgent
from arete_agents.agents.test_coverage import TestCoverageAgent
from arete_agents.eval.matcher import DEFAULT_WINDOW, match_comments
from arete_agents.eval.models import EvalFixture, FixtureAgentResult

AGENT_NAMES = [
    "security", "performance", "quality",
    "test_coverage", "deployment_safety", "business_logic",
]

_AGENT_CLASSES = [
    SecurityAgent, PerformanceAgent, QualityAgent,
    TestCoverageAgent, DeploymentSafetyAgent, BusinessLogicAgent,
]


def build_agents(llm) -> list:
    return [cls(llm) for cls in _AGENT_CLASSES]


def run_fixture(
    fixture: EvalFixture,
    agents: list,
    judge,
    is_stub: bool,
    window: int = DEFAULT_WINDOW,
) -> list[FixtureAgentResult]:
    results: list[FixtureAgentResult] = []
    for agent in agents:
        comments = []
        for file in fixture.pr.files:
            try:
                review = agent.review_file(file, fixture.pr)
                comments.extend(review.comments)
            except Exception:
                continue
        relevant = [
            d for d in fixture.planted_defects if d.target_agent == agent.agent_name
        ]
        match_results = match_comments(
            comments, relevant, judge, is_stub, window
        )
        results.append(
            FixtureAgentResult(
                fixture_id=fixture.id,
                agent=agent.agent_name,
                relevant_defects=relevant,
                comments=comments,
                match_results=match_results,
            )
        )
    return results


def run_all(
    fixtures: list[EvalFixture],
    agents: list,
    judge,
    is_stub: bool,
    window: int = DEFAULT_WINDOW,
) -> list[FixtureAgentResult]:
    out: list[FixtureAgentResult] = []
    for fixture in fixtures:
        out.extend(run_fixture(fixture, agents, judge, is_stub, window))
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_eval_runner.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/eval/runner.py packages/agents/tests/test_eval_runner.py
git commit -m "feat(eval): add runner executing agents over fixtures"
```

---

### Task 6: Report builder (aggregate + JSON/Markdown render)

**Files:**
- Create: `packages/agents/src/arete_agents/eval/report.py`
- Test: `packages/agents/tests/test_eval_report.py`

**Interfaces:**
- Consumes: `FixtureAgentResult`, `AgentScore`, `EvalReport` from Task 1; `score_agent`, `aggregate_overall`, `collect_misses`, `collect_false_positives` from Task 2; `AGENT_NAMES` from Task 5.
- Produces:
  - `build_report(results: list[FixtureAgentResult], meta: dict[str, str] | None = None) -> EvalReport` — one `AgentScore` per name in `AGENT_NAMES` (even if zero results), plus overall/misses/false_positives.
  - `render_markdown(report: EvalReport) -> str`
  - `render_json(report: EvalReport) -> str` (pretty-printed, 2-space indent)

- [ ] **Step 1: Write the failing test**

Create `packages/agents/tests/test_eval_report.py`:

```python
import json

from arete_agents.models.review import ReviewComment
from arete_agents.eval.models import FixtureAgentResult, MatchResult, PlantedDefect
from arete_agents.eval.report import build_report, render_json, render_markdown


def _tp_result() -> FixtureAgentResult:
    d = PlantedDefect(id="d1", path="a.py", line=5, target_agent="security", description="x", severity="error")
    c = ReviewComment(path="a.py", line=5, body="b", severity="error", category="security")
    return FixtureAgentResult(
        fixture_id="f1", agent="security", relevant_defects=[d], comments=[c],
        match_results=[MatchResult(defect_id="d1", comment=c, localization_ok=True, description_ok=True)],
    )


def test_build_report_has_all_six_agents():
    report = build_report([_tp_result()])
    assert len(report.per_agent) == 6
    names = {s.agent for s in report.per_agent}
    assert names == {
        "security", "performance", "quality",
        "test_coverage", "deployment_safety", "business_logic",
    }


def test_overall_reflects_tp():
    report = build_report([_tp_result()])
    assert report.overall.tp == 1
    assert report.overall.f1 == 1.0


def test_render_markdown_contains_table_and_meta():
    report = build_report([_tp_result()], meta={"judge": "stub"})
    md = render_markdown(report)
    assert "F1" in md
    assert "security" in md
    assert "judge" in md


def test_render_json_roundtrips():
    report = build_report([_tp_result()])
    data = json.loads(render_json(report))
    assert data["overall"]["tp"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_eval_report.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arete_agents.eval.report'`

- [ ] **Step 3: Write the report builder**

Create `packages/agents/src/arete_agents/eval/report.py`:

```python
from arete_agents.eval.models import AgentScore, EvalReport, FixtureAgentResult
from arete_agents.eval.runner import AGENT_NAMES
from arete_agents.eval.scorer import (
    aggregate_overall,
    collect_false_positives,
    collect_misses,
    score_agent,
)


def build_report(
    results: list[FixtureAgentResult],
    meta: dict[str, str] | None = None,
) -> EvalReport:
    per_agent: list[AgentScore] = []
    for name in AGENT_NAMES:
        agent_results = [r for r in results if r.agent == name]
        per_agent.append(score_agent(name, agent_results))
    overall = aggregate_overall(per_agent)
    return EvalReport(
        per_agent=per_agent,
        overall=overall,
        misses=collect_misses(results),
        false_positives=collect_false_positives(results),
        meta=meta or {},
    )


def _row(s: AgentScore) -> str:
    return (
        f"| {s.agent} | {s.tp} | {s.fp} | {s.fn} | "
        f"{s.precision:.3f} | {s.recall:.3f} | {s.f1:.3f} | {s.fp_rate:.3f} |"
    )


def render_markdown(report: EvalReport) -> str:
    lines = ["# Areté Agent Eval Report", ""]
    if report.meta:
        lines.append("## Run metadata")
        lines.append("")
        for key, value in sorted(report.meta.items()):
            lines.append(f"- **{key}**: {value}")
        lines.append("")
    lines.append("## Scores")
    lines.append("")
    lines.append("| Agent | TP | FP | FN | Precision | Recall | F1 | FP-rate |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for s in report.per_agent:
        lines.append(_row(s))
    lines.append(_row(report.overall))
    lines.append("")
    lines.append(f"**Misses (FN):** {len(report.misses)}")
    lines.append(f"**False positives (FP):** {len(report.false_positives)}")
    lines.append("")
    return "\n".join(lines)


def render_json(report: EvalReport) -> str:
    return report.model_dump_json(indent=2)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_eval_report.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/eval/report.py packages/agents/tests/test_eval_report.py
git commit -m "feat(eval): add report builder with JSON and Markdown renderers"
```

---

### Task 7: Config settings + CLI entry point + regression gate

**Files:**
- Modify: `packages/agents/src/arete_agents/config.py` (additive fields only)
- Create: `packages/agents/src/arete_agents/eval/__main__.py`
- Test: `packages/agents/tests/test_eval_cli.py`

**Interfaces:**
- Consumes: `get_settings`, `Settings` from `arete_agents.config`; `build_gemini_llm`/`build_anthropic_llm` from `arete_agents.llm.*`; `load_fixtures` (Task 4); `build_agents`, `run_all` (Task 5); `build_judge` (Task 3); `build_report`, `render_markdown`, `render_json` (Task 6); `f1_regressed` (Task 2).
- Produces (in `__main__.py`):
  - `resolve_providers(settings, judge_flag: str | None) -> tuple[str, str]` returning `(finder_provider, judge_mode)`. `finder_provider = settings.eval_finder_provider or settings.llm_provider`. If `judge_flag` given, `judge_mode = judge_flag`. Else `judge_mode = settings.eval_judge_provider or ("anthropic" if finder_provider == "gemini" else "gemini")` (heterogeneous default).
  - `build_finder_llm(provider: str, settings) -> BaseChatModel`.
  - `main(argv: list[str] | None = None) -> int` — parses args, runs eval, writes report, applies regression gate, returns exit code.
- New `Settings` fields: `eval_finder_provider: Literal["gemini","anthropic"] | None = None`, `eval_judge_provider: Literal["gemini","anthropic"] | None = None`, `eval_f1_threshold: float = 0.05`.

- [ ] **Step 1: Write the failing test**

Create `packages/agents/tests/test_eval_cli.py`:

```python
from arete_agents.config import Settings
from arete_agents.eval.__main__ import resolve_providers


def _settings(**kw) -> Settings:
    base = dict(llm_provider="gemini", gemini_api_key="k", anthropic_api_key="k")
    base.update(kw)
    return Settings(**base)


def test_new_config_fields_default_none():
    s = _settings()
    assert s.eval_finder_provider is None
    assert s.eval_judge_provider is None
    assert s.eval_f1_threshold == 0.05


def test_heterogeneous_judge_default_gemini_finder():
    finder, judge = resolve_providers(_settings(llm_provider="gemini"), None)
    assert finder == "gemini"
    assert judge == "anthropic"


def test_heterogeneous_judge_default_anthropic_finder():
    finder, judge = resolve_providers(_settings(llm_provider="anthropic"), None)
    assert finder == "anthropic"
    assert judge == "gemini"


def test_judge_flag_overrides():
    finder, judge = resolve_providers(_settings(llm_provider="gemini"), "stub")
    assert judge == "stub"


def test_finder_override_setting():
    finder, judge = resolve_providers(
        _settings(llm_provider="gemini", eval_finder_provider="anthropic"), None
    )
    assert finder == "anthropic"
    assert judge == "gemini"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_eval_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arete_agents.eval.__main__'` (and, once importable, failures on the new settings fields not yet existing).

- [ ] **Step 3: Add config fields**

Read `packages/agents/src/arete_agents/config.py` first (per repo convention, the file must be read before editing). Locate the two-line block:

```python
    database_url: str = "postgresql://arete:arete@localhost:5432/arete"
    redis_url: str = "redis://localhost:6379"
```

Using an Edit (not a full rewrite), replace that exact two-line block with:

```python
    database_url: str = "postgresql://arete:arete@localhost:5432/arete"
    redis_url: str = "redis://localhost:6379"

    eval_finder_provider: Literal["gemini", "anthropic"] | None = None
    eval_judge_provider: Literal["gemini", "anthropic"] | None = None
    eval_f1_threshold: float = 0.05
```

This preserves `redis_url`'s existing value unchanged and only appends the three new fields below it. `Literal` is already imported at the top of `config.py` — no new import needed.

- [ ] **Step 4: Write the CLI**

Create `packages/agents/src/arete_agents/eval/__main__.py`:

```python
import argparse
import json
import sys
from pathlib import Path

from langchain_core.language_models import BaseChatModel

from arete_agents.config import Settings, get_settings
from arete_agents.eval.loader import load_fixtures
from arete_agents.eval.matcher import DEFAULT_WINDOW, build_judge
from arete_agents.eval.report import build_report, render_json, render_markdown
from arete_agents.eval.runner import build_agents, run_all
from arete_agents.eval.scorer import f1_regressed

_DEFAULT_FIXTURES = Path(__file__).resolve().parents[3] / "eval" / "fixtures"
_DEFAULT_BASELINE = Path(__file__).resolve().parents[3] / "eval" / "baseline.json"


def resolve_providers(settings: Settings, judge_flag: str | None) -> tuple[str, str]:
    finder = settings.eval_finder_provider or settings.llm_provider
    if judge_flag is not None:
        judge = judge_flag
    elif settings.eval_judge_provider is not None:
        judge = settings.eval_judge_provider
    else:
        judge = "anthropic" if finder == "gemini" else "gemini"
    return finder, judge


def build_finder_llm(provider: str, settings: Settings) -> BaseChatModel:
    if provider == "gemini":
        from arete_agents.llm.gemini import build_gemini_llm

        return build_gemini_llm(settings.gemini_api_key)
    if provider == "anthropic":
        from arete_agents.llm.anthropic import build_anthropic_llm

        return build_anthropic_llm(settings.anthropic_api_key)
    raise ValueError(f"Unknown finder provider: {provider!r}")


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="arete_agents.eval")
    parser.add_argument("--agent", default=None, help="Restrict scoring to one agent name.")
    parser.add_argument("--fixtures", default=str(_DEFAULT_FIXTURES))
    parser.add_argument("--judge", choices=["gemini", "anthropic", "stub"], default=None)
    parser.add_argument("--report", choices=["md", "json"], default="md")
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW)
    parser.add_argument("--update-baseline", action="store_true")
    parser.add_argument("--baseline", default=str(_DEFAULT_BASELINE))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    settings = get_settings()
    finder_provider, judge_mode = resolve_providers(settings, args.judge)

    fixtures = load_fixtures(Path(args.fixtures))
    finder_llm = build_finder_llm(finder_provider, settings)
    agents = build_agents(finder_llm)
    if args.agent:
        agents = [a for a in agents if a.agent_name == args.agent]
    judge, is_stub = build_judge(
        judge_mode, settings.gemini_api_key, settings.anthropic_api_key
    )

    results = run_all(fixtures, agents, judge, is_stub, args.window)
    meta = {
        "finder_provider": finder_provider,
        "judge_mode": judge_mode,
        "window": str(args.window),
        "fixtures": str(len(fixtures)),
    }
    report = build_report(results, meta=meta)

    if args.report == "json":
        print(render_json(report))
    else:
        print(render_markdown(report))

    baseline_path = Path(args.baseline)
    if args.update_baseline:
        baseline_path.write_text(render_json(report), encoding="utf-8")
        print(f"\nBaseline written to {baseline_path}", file=sys.stderr)
        return 0

    if baseline_path.exists():
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        base_f1 = baseline.get("overall", {}).get("f1", 0.0)
        if f1_regressed(report.overall.f1, base_f1, settings.eval_f1_threshold):
            print(
                f"\nF1 REGRESSION: {report.overall.f1:.3f} < "
                f"{base_f1:.3f} - {settings.eval_f1_threshold}",
                file=sys.stderr,
            )
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/test_eval_cli.py -v`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/config.py packages/agents/src/arete_agents/eval/__main__.py packages/agents/tests/test_eval_cli.py
git commit -m "feat(eval): add CLI, config settings, and F1 regression gate"
```

---

### Task 8: Golden fixture set v1

**Files:**
- Create: `packages/agents/eval/fixtures/security-sqli.json`
- Create: `packages/agents/eval/fixtures/security-secret.json`
- Create: `packages/agents/eval/fixtures/performance-nplusone.json`
- Create: `packages/agents/eval/fixtures/performance-quadratic.json`
- Create: `packages/agents/eval/fixtures/quality-swallowed-exception.json`
- Create: `packages/agents/eval/fixtures/quality-dead-code.json`
- Create: `packages/agents/eval/fixtures/testcoverage-untested-branch.json`
- Create: `packages/agents/eval/fixtures/testcoverage-no-test.json`
- Create: `packages/agents/eval/fixtures/deploysafety-no-migration.json`
- Create: `packages/agents/eval/fixtures/deploysafety-breaking-api.json`
- Create: `packages/agents/eval/fixtures/bizlogic-offbyone.json`
- Create: `packages/agents/eval/fixtures/bizlogic-inverted-rule.json`
- Create: `packages/agents/eval/fixtures/clean-python.json`
- Create: `packages/agents/eval/fixtures/clean-typescript.json`
- Create: `packages/agents/eval/fixtures/clean-sql.json`
- Test: `packages/agents/tests/test_eval_fixtures.py`

**Interfaces:**
- Consumes: `load_fixtures` (Task 4), `AGENT_NAMES` (Task 5).
- Produces: 12 defective fixtures (2 per agent) + 3 clean fixtures on disk, all loadable and schema-valid.

- [ ] **Step 1: Write the failing test**

Create `packages/agents/tests/test_eval_fixtures.py`:

```python
from collections import Counter
from pathlib import Path

from arete_agents.eval.loader import load_fixtures
from arete_agents.eval.runner import AGENT_NAMES

_FIXTURES = Path(__file__).resolve().parents[1] / "eval" / "fixtures"


def test_fixtures_load():
    fixtures = load_fixtures(_FIXTURES)
    assert len(fixtures) == 15


def test_two_defects_per_agent():
    fixtures = load_fixtures(_FIXTURES)
    counts = Counter(
        d.target_agent for f in fixtures for d in f.planted_defects
    )
    for name in AGENT_NAMES:
        assert counts[name] == 2, f"{name} should have exactly 2 planted defects"


def test_three_clean_fixtures_have_no_defects():
    fixtures = load_fixtures(_FIXTURES)
    clean = [f for f in fixtures if f.clean]
    assert len(clean) == 3
    assert all(f.planted_defects == [] for f in clean)


def test_defect_paths_exist_in_pr_files():
    fixtures = load_fixtures(_FIXTURES)
    for f in fixtures:
        file_paths = {fc.path for fc in f.pr.files}
        for d in f.planted_defects:
            assert d.path in file_paths, f"{f.id}: defect path {d.path} not in PR files"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_eval_fixtures.py -v`
Expected: FAIL — `FileNotFoundError` (directory absent) or count assertion (0 != 15).

- [ ] **Step 3: Create the 12 defective fixtures**

Create each file below verbatim. Each `patch` uses unified-diff `+` lines; `line` is the 1-based line number of the added line within the shown snippet (counting from the first `+` line as line 1).

`packages/agents/eval/fixtures/security-sqli.json`:

```json
{
  "id": "security-sqli",
  "pr": {
    "repo": "acme/api",
    "pr_number": 101,
    "title": "Add user lookup endpoint",
    "description": "Looks up a user by id.",
    "files": [
      {
        "path": "src/users.py",
        "patch": "@@ -0,0 +1,4 @@\n+def get_user(conn, user_id):\n+    query = \"SELECT * FROM users WHERE id = '%s'\" % user_id\n+    return conn.execute(query).fetchone()\n+",
        "additions": 4,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "sqli-001",
      "path": "src/users.py",
      "line": 2,
      "target_agent": "security",
      "description": "SQL injection: user_id is interpolated directly into the SQL string via % formatting instead of using a parameterized query.",
      "severity": "error"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/security-secret.json`:

```json
{
  "id": "security-secret",
  "pr": {
    "repo": "acme/api",
    "pr_number": 102,
    "title": "Add payment client",
    "description": "Initializes the Stripe client.",
    "files": [
      {
        "path": "src/payments/client.py",
        "patch": "@@ -0,0 +1,3 @@\n+import stripe\n+stripe.api_key = \"sk_live_51H8xAbCdEfGhIjKlMnOpQrStUvWx\"\n+client = stripe\n+",
        "additions": 3,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "secret-001",
      "path": "src/payments/client.py",
      "line": 2,
      "target_agent": "security",
      "description": "Hardcoded secret: a live Stripe API key is committed in source instead of being read from an environment variable or secret manager.",
      "severity": "error"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/performance-nplusone.json`:

```json
{
  "id": "performance-nplusone",
  "pr": {
    "repo": "acme/api",
    "pr_number": 103,
    "title": "Render order list",
    "description": "Builds a list of order summaries.",
    "files": [
      {
        "path": "src/orders/report.py",
        "patch": "@@ -0,0 +1,5 @@\n+def summarize(orders):\n+    rows = []\n+    for order in orders:\n+        rows.append(order.customer.fetch().name)\n+    return rows\n+",
        "additions": 5,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "nplus1-001",
      "path": "src/orders/report.py",
      "line": 4,
      "target_agent": "performance",
      "description": "N+1 query: order.customer.fetch() runs a separate database query on every loop iteration instead of batching or eager-loading customers.",
      "severity": "warning"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/performance-quadratic.json`:

```json
{
  "id": "performance-quadratic",
  "pr": {
    "repo": "acme/api",
    "pr_number": 104,
    "title": "Deduplicate incoming ids",
    "description": "Removes duplicate ids from a request.",
    "files": [
      {
        "path": "src/dedupe.py",
        "patch": "@@ -0,0 +1,7 @@\n+def unique(items):\n+    result = []\n+    for item in items:\n+        if item not in result:\n+            result.append(item)\n+    return result\n+",
        "additions": 7,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "quad-001",
      "path": "src/dedupe.py",
      "line": 4,
      "target_agent": "performance",
      "description": "Quadratic complexity: 'item not in result' scans the growing list on every iteration, making deduplication O(n^2); a set would make it O(n).",
      "severity": "warning"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/quality-swallowed-exception.json`:

```json
{
  "id": "quality-swallowed-exception",
  "pr": {
    "repo": "acme/api",
    "pr_number": 105,
    "title": "Parse config file",
    "description": "Loads optional config.",
    "files": [
      {
        "path": "src/config_loader.py",
        "patch": "@@ -0,0 +1,6 @@\n+def load(path):\n+    try:\n+        return parse(open(path).read())\n+    except Exception:\n+        pass\n+    return None\n+",
        "additions": 6,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "swallow-001",
      "path": "src/config_loader.py",
      "line": 4,
      "target_agent": "quality",
      "description": "Swallowed exception: a bare 'except Exception: pass' hides all errors and returns None, discarding the failure cause and making debugging impossible.",
      "severity": "warning"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/quality-dead-code.json`:

```json
{
  "id": "quality-dead-code",
  "pr": {
    "repo": "acme/api",
    "pr_number": 106,
    "title": "Compute discount",
    "description": "Returns a discount amount.",
    "files": [
      {
        "path": "src/pricing.py",
        "patch": "@@ -0,0 +1,5 @@\n+def discount(total):\n+    return total * 0.1\n+    if total > 100:\n+        return total * 0.2\n+",
        "additions": 5,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "dead-001",
      "path": "src/pricing.py",
      "line": 3,
      "target_agent": "quality",
      "description": "Dead/unreachable code: the 'if total > 100' branch follows an unconditional return and can never execute.",
      "severity": "warning"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/testcoverage-untested-branch.json`:

```json
{
  "id": "testcoverage-untested-branch",
  "pr": {
    "repo": "acme/api",
    "pr_number": 107,
    "title": "Add refund guard",
    "description": "Adds a new refund branch but no test.",
    "files": [
      {
        "path": "src/refunds.py",
        "patch": "@@ -1,3 +1,6 @@\n def refund(amount, is_admin):\n-    return process(amount)\n+    if is_admin:\n+        return process(amount)\n+    raise PermissionError(\"not allowed\")\n+",
        "additions": 4,
        "deletions": 1
      }
    ]
  },
  "planted_defects": [
    {
      "id": "untested-001",
      "path": "src/refunds.py",
      "line": 2,
      "target_agent": "test_coverage",
      "description": "New untested branch: the added is_admin conditional and the PermissionError path introduce behavior with no accompanying test.",
      "severity": "warning"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/testcoverage-no-test.json`:

```json
{
  "id": "testcoverage-no-test",
  "pr": {
    "repo": "acme/api",
    "pr_number": 108,
    "title": "Add tax helper",
    "description": "New public helper with no test file changed.",
    "files": [
      {
        "path": "src/tax.py",
        "patch": "@@ -0,0 +1,3 @@\n+def apply_tax(amount, rate):\n+    return amount + amount * rate\n+",
        "additions": 3,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "notest-001",
      "path": "src/tax.py",
      "line": 1,
      "target_agent": "test_coverage",
      "description": "New public function apply_tax is added with no corresponding unit test in the PR.",
      "severity": "warning"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/deploysafety-no-migration.json`:

```json
{
  "id": "deploysafety-no-migration",
  "pr": {
    "repo": "acme/api",
    "pr_number": 109,
    "title": "Add column to model",
    "description": "Adds a non-null column but no migration.",
    "files": [
      {
        "path": "src/models/user.py",
        "patch": "@@ -1,3 +1,4 @@\n class User(Base):\n     id = Column(Integer, primary_key=True)\n+    country = Column(String, nullable=False)\n+",
        "additions": 2,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "nomig-001",
      "path": "src/models/user.py",
      "line": 3,
      "target_agent": "deployment_safety",
      "description": "Schema change without migration: a non-nullable 'country' column is added to the User model but no database migration accompanies it, which will break deploys against existing data.",
      "severity": "error"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/deploysafety-breaking-api.json`:

```json
{
  "id": "deploysafety-breaking-api",
  "pr": {
    "repo": "acme/api",
    "pr_number": 110,
    "title": "Rename response field",
    "description": "Renames a public API field.",
    "files": [
      {
        "path": "src/api/schemas.py",
        "patch": "@@ -1,3 +1,3 @@\n class UserOut(BaseModel):\n-    name: str\n+    full_name: str\n",
        "additions": 1,
        "deletions": 1
      }
    ]
  },
  "planted_defects": [
    {
      "id": "breakapi-001",
      "path": "src/api/schemas.py",
      "line": 1,
      "target_agent": "deployment_safety",
      "description": "Breaking public API change: renaming the response field 'name' to 'full_name' breaks existing API consumers relying on the old field name.",
      "severity": "error"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/bizlogic-offbyone.json`:

```json
{
  "id": "bizlogic-offbyone",
  "pr": {
    "repo": "acme/api",
    "pr_number": 111,
    "title": "Paginate results",
    "description": "Slices a page of results.",
    "files": [
      {
        "path": "src/pagination.py",
        "patch": "@@ -0,0 +1,4 @@\n+def page(items, page_num, size):\n+    start = page_num * size\n+    return items[start:start + size + 1]\n+",
        "additions": 4,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "offbyone-001",
      "path": "src/pagination.py",
      "line": 3,
      "target_agent": "business_logic",
      "description": "Off-by-one error: the slice end is 'start + size + 1', returning one extra item per page beyond the requested page size.",
      "severity": "warning"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures/bizlogic-inverted-rule.json`:

```json
{
  "id": "bizlogic-inverted-rule",
  "pr": {
    "repo": "acme/api",
    "pr_number": 112,
    "title": "Apply loyalty discount",
    "description": "Applies discount to loyalty members.",
    "files": [
      {
        "path": "src/discount.py",
        "patch": "@@ -0,0 +1,4 @@\n+def price(base, is_member):\n+    if not is_member:\n+        return base * 0.8\n+    return base\n+",
        "additions": 4,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "inverted-001",
      "path": "src/discount.py",
      "line": 2,
      "target_agent": "business_logic",
      "description": "Inverted business rule: the discount is applied when the user is NOT a member ('if not is_member'), the opposite of the intended loyalty-member discount.",
      "severity": "error"
    }
  ],
  "clean": false
}
```

- [ ] **Step 4: Create the 3 clean fixtures**

`packages/agents/eval/fixtures/clean-python.json`:

```json
{
  "id": "clean-python",
  "pr": {
    "repo": "acme/api",
    "pr_number": 201,
    "title": "Add safe user lookup",
    "description": "Parameterized query, typed, tested.",
    "files": [
      {
        "path": "src/users_safe.py",
        "patch": "@@ -0,0 +1,3 @@\n+def get_user(conn, user_id: int):\n+    return conn.execute(\"SELECT * FROM users WHERE id = ?\", (user_id,)).fetchone()\n+",
        "additions": 3,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [],
  "clean": true
}
```

`packages/agents/eval/fixtures/clean-typescript.json`:

```json
{
  "id": "clean-typescript",
  "pr": {
    "repo": "acme/web",
    "pr_number": 202,
    "title": "Add sum helper",
    "description": "Simple pure function.",
    "files": [
      {
        "path": "src/sum.ts",
        "patch": "@@ -0,0 +1,3 @@\n+export function sum(a: number, b: number): number {\n+  return a + b;\n+}\n+",
        "additions": 3,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [],
  "clean": true
}
```

`packages/agents/eval/fixtures/clean-sql.json`:

```json
{
  "id": "clean-sql",
  "pr": {
    "repo": "acme/api",
    "pr_number": 203,
    "title": "Add index",
    "description": "Adds a concurrent index safely.",
    "files": [
      {
        "path": "migrations/0002_add_index.sql",
        "patch": "@@ -0,0 +1,2 @@\n+CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);\n+",
        "additions": 2,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [],
  "clean": true
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/test_eval_fixtures.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/agents/eval/fixtures/ packages/agents/tests/test_eval_fixtures.py
git commit -m "feat(eval): add v1 golden fixture set (12 defective + 3 clean)"
```

---

### Task 9: End-to-end self-check, committed baseline, and no-regression verification

**Files:**
- Create: `packages/agents/eval/fixtures_selfcheck/selfcheck-hit.json`
- Create: `packages/agents/eval/fixtures_selfcheck/selfcheck-clean.json`
- Test: `packages/agents/tests/test_eval_integration.py`
- Create: `packages/agents/eval/baseline.json` (generated by command, not hand-written)

**Interfaces:**
- Consumes: everything above; drives the full pipeline with a mocked finder LLM (deterministic) and the stub judge to assert exact metric values, then (if API keys are available) confirms the same pipeline against real fixtures and writes the committed baseline.

- [ ] **Step 1: Write the self-check fixtures**

`packages/agents/eval/fixtures_selfcheck/selfcheck-hit.json`:

```json
{
  "id": "selfcheck-hit",
  "pr": {
    "repo": "acme/api",
    "pr_number": 900,
    "title": "selfcheck hit",
    "description": "One planted security defect at line 5.",
    "files": [
      {
        "path": "src/auth.py",
        "patch": "@@ -0,0 +1,6 @@\n+def q(user_id):\n+    return \"SELECT * FROM users WHERE id = '%s'\" % user_id\n+",
        "additions": 6,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [
    {
      "id": "self-sqli",
      "path": "src/auth.py",
      "line": 5,
      "target_agent": "security",
      "description": "SQL injection via string formatting.",
      "severity": "error"
    }
  ],
  "clean": false
}
```

`packages/agents/eval/fixtures_selfcheck/selfcheck-clean.json`:

```json
{
  "id": "selfcheck-clean",
  "pr": {
    "repo": "acme/api",
    "pr_number": 901,
    "title": "selfcheck clean",
    "description": "No defects; any finding is a false positive.",
    "files": [
      {
        "path": "src/ok.py",
        "patch": "@@ -0,0 +1,2 @@\n+def add(a, b):\n+    return a + b\n+",
        "additions": 2,
        "deletions": 0
      }
    ]
  },
  "planted_defects": [],
  "clean": true
}
```

- [ ] **Step 2: Write the integration test (mocked finder, stub judge, exact metrics)**

Create `packages/agents/tests/test_eval_integration.py`:

```python
from pathlib import Path
from unittest.mock import MagicMock

from langchain_core.messages import AIMessage

from arete_agents.eval.loader import load_fixtures
from arete_agents.eval.matcher import StubJudge
from arete_agents.eval.report import build_report
from arete_agents.eval.runner import build_agents, run_all

_SELFCHECK = Path(__file__).resolve().parents[1] / "eval" / "fixtures_selfcheck"

_SEC_HIT = (
    '{"comments": [{"path": "src/auth.py", "line": 5, '
    '"body": "SQL injection via string formatting.", "severity": "error", '
    '"category": "security"}], "summary": "sqli"}'
)
_EMPTY = '{"comments": [], "summary": "no issues"}'


def _finder_llm():
    # The security agent always reports the src/auth.py line-5 finding; every
    # other agent (and security itself on the clean fixture, which has no
    # src/auth.py file) reports nothing. Detection is by system-prompt content
    # via BaseReviewAgent._build_user_prompt's "for {agent_name} issues" line,
    # which SystemMessage does not carry -- instead we key off which agent
    # instance is calling by inspecting the HumanMessage content itself: the
    # user prompt embeds "Review this pull request file for security issues."
    mock = MagicMock()

    def _invoke(messages):
        human = messages[-1].content if messages else ""
        if "for security issues" in human:
            return AIMessage(content=_SEC_HIT)
        return AIMessage(content=_EMPTY)

    mock.invoke.side_effect = _invoke
    mock.with_retry.return_value = mock
    return mock


def test_selfcheck_metrics_are_exact():
    fixtures = load_fixtures(_SELFCHECK)
    agents = build_agents(_finder_llm())
    results = run_all(fixtures, agents, StubJudge(), is_stub=True)
    report = build_report(results, meta={"judge": "stub"})

    sec = next(s for s in report.per_agent if s.agent == "security")
    assert (sec.tp, sec.fn) == (1, 0)
    assert sec.recall == 1.0
    assert report.overall.fp == 0
    assert report.overall.tp == 1
    assert report.overall.f1 == 1.0
```

Note: this test relies on `BaseReviewAgent._build_user_prompt` (`packages/agents/src/arete_agents/agents/base.py:35`) containing the literal string `"Review this pull request file for {self.agent_name} issues."`, which for the security agent renders as `"...for security issues."`. This is existing, unmodified source — the test only reads it.

- [ ] **Step 3: Run the integration test**

Run: `uv run pytest tests/test_eval_integration.py -v`
Expected: PASS (1 test). If it fails because the detection substring doesn't match, open `packages/agents/src/arete_agents/agents/base.py` and confirm the exact literal text of `_build_user_prompt`'s first line, then update only the test's `"for security issues" in human` substring to match — do not change source.

- [ ] **Step 4: Run the FULL suite — verify no regression of the 29-test baseline**

Run: `uv run pytest -v`
Expected: all previously-passing tests still pass. Total = 29 (original) + all new eval tests from Tasks 1-9, 0 failed. If any originally-passing test now fails, STOP and fix the eval code — the additive constraint was violated.

- [ ] **Step 5: Generate the committed baseline (stub judge, deterministic, no API keys required for the judge — finder agents still need a key)**

Run from `packages/agents`. If `GEMINI_API_KEY`/`ANTHROPIC_API_KEY` are configured in `.env`, run directly:

```bash
uv run python -m arete_agents.eval --judge stub --report json --update-baseline
```

Expected: prints a JSON report to stdout, then `Baseline written to .../eval/baseline.json` on stderr, exit code 0.

If no API key is available in this environment, this step cannot run live (the finder agents require a real LLM call). In that case, record this explicitly as a deferred step — do not fabricate a baseline. Instead write a minimal, honest placeholder baseline so the CLI's regression gate has a defined floor until a real run is possible:

```bash
mkdir -p ../agents/eval 2>/dev/null; true
```

Then create `packages/agents/eval/baseline.json` with this exact content (an explicit zero-floor baseline, not a fabricated score):

```json
{
  "per_agent": [],
  "overall": {"agent": "overall", "tp": 0, "fp": 0, "fn": 0, "precision": 0.0, "recall": 0.0, "f1": 0.0, "fp_rate": 0.0},
  "misses": [],
  "false_positives": [],
  "meta": {"note": "placeholder baseline - no API key available at generation time; replace via --update-baseline once a real run is possible"}
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/agents/eval/fixtures_selfcheck/ packages/agents/tests/test_eval_integration.py packages/agents/eval/baseline.json
git commit -m "test(eval): add end-to-end self-check, verify no regression, commit baseline"
```

---

## Self-Review

**Spec coverage:**
- §1 Goal (P/R/F1/FP-rate per agent) → Tasks 2, 6. Covered.
- §3 scope: loader (T4), runner (T5), hybrid matcher (T3), scorer+report (T2/T6), CLI+baseline+gate (T7), offline tests + mandatory live verification (T9). Covered.
- §4 principles: additive/non-damaging (Global Constraints; config change in T7 is append-only via Edit, not rewrite); best-model-per-role heterogeneous judge (T7 `resolve_providers`); low-lag offline + cheap gate first (T3 gate before judge); tech-stack reuse (existing models/LLM builders, no new deps). Covered.
- §5 architecture module layout → Tasks 1-7 create exactly `models/loader/runner/matcher/scorer/report/__main__` plus `eval/fixtures/` and `eval/baseline.json`. Covered.
- §6 data model → Task 1 (added `FixtureAgentResult` as an internal carrier not named in the spec's data model table, needed to pass per-fixture-per-agent results between runner/scorer/report; spec's `PlantedDefect`/`EvalFixture`/`MatchResult`/`AgentScore`/`EvalReport` all present with identical fields). Covered.
- §7 matcher (gate + judge, modes stub/gemini/anthropic, bookkeeping) → Task 3. Covered.
- §8 model roles (heterogeneous default, additive settings) → Task 7. Covered.
- §9 CLI flags + F1-drop gate (0.05) → Task 7. Covered.
- §10 fixture set (2/agent + 3 clean, multi-language) → Task 8. Covered.
- §12 offline unit tests (loader/matcher/scorer) + mandatory live verification + no-regression → Tasks 4, 3, 2, 9. Covered.
- §13 risks: stub judge determinism (T3/T7/T9), provider/model recorded in report meta (T6/T7), fixture-overfitting and small-sample-noise risks are documentation-level and don't require a task.

**Placeholder scan:** removed the earlier scaffold artifact from Task 1 entirely — Step 1 now contains only the real, final test file content. Task 9 Step 5's no-API-key branch is not a vague TBD; it gives the exact fallback JSON to write and states plainly that it's an honest zero-floor placeholder pending a real run, consistent with "no fabricated metrics."

**Type consistency:** `AGENT_NAMES` list identical across Tasks 5, 6, 8. `MatchResult(defect_id, comment, localization_ok, description_ok)` used identically in Tasks 1/2/3/9. `score_agent`/`aggregate_overall`/`f1_regressed` signatures match between Task 2's definition and Tasks 6/7's consumption. `build_judge` returns `(judge, is_stub)` in Task 3 and is unpacked that way in Task 7. `run_all(fixtures, agents, judge, is_stub, window)` signature matches between Task 5's definition and Tasks 7/9's calls. Config edit in Task 7 is specified as a targeted Edit against verified existing lines (confirmed via Read in this session), not a blind rewrite.
