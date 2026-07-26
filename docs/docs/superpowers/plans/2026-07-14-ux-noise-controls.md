# SP6: UX Noise Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `silence_as_noise`/`place_under_observation` cause a real, durable effect (excluded from the GitHub post, persisted with real `noiseState`), and make recurrence-based escalation across PRs real — closing the loop on scaffolding that has existed since commit `5d83c77` but has never done anything but return canned strings.

**Architecture:** A specialist agent's `review_file()` tool loop already sees every `silence_as_noise`/`place_under_observation` call before the LLM's final JSON is even parsed; it now records these as `NoiseDecision`s alongside its `FileReview`. The orchestrator threads these through `GraphState` (mirroring the existing `raw_reviews` reducer) and, after synthesis/critic/grounding, stamps the surviving comments' `noise_state`/`escalate_on`/`threshold` deterministically — never trusting the LLM's own JSON to self-report this. The webhook then persists these fields for real and filters non-`OPEN` comments out of the GitHub post. Escalation (recurrence across PRs) is folded into the existing `persistReview` call rather than resurrecting the standalone `noise_escalator.py` process, since this repo has no deployment/cron infrastructure for a standalone worker and the natural trigger point ("a new review just completed") already runs there.

**Tech Stack:** Python (LangChain tool-calling loop, LangGraph, Pydantic), TypeScript (Prisma, Vitest), Prisma schema/migrations.

## Global Constraints

- Silenced/observed findings are suppressed from the GitHub post, not dropped before persistence — every finding still becomes a real `ReviewComment` row (audit trail).
- `issue_id` (a tool argument, not a DB id) is parsed as `"path:line"` — a malformed `issue_id` is silently dropped (fail-open), never raises.
- Noise state is stamped by deterministic Python code matching recorded tool calls against surviving comments — never taken from the LLM's own JSON output.
- Escalation recurrence match key is exactly `(repositoryId, path, category)` — no semantic/embedding similarity. This is a deliberate YAGNI choice.
- `noise_escalator.py` is deleted entirely, not left as dead scaffolding — escalation runs inline in `persistReview`.
- All new Pydantic/Prisma fields are additive with safe defaults (`"OPEN"`, `None`, `1`) — every existing constructor call across the test suites must keep working unchanged.
- Field naming: the Python agents service emits JSON with unchanged Python field names (`noise_state`, `escalate_on`, `threshold` — snake_case, no alias), exactly like the existing `risk_level`/`overall_summary`/`pr_context` fields on `ReviewResult` already do. The webhook's `types.ts` mirrors this as snake_case. Only `persistence.ts`'s Prisma write translates to the schema's camelCase (`noiseState`/`escalateOn`/`threshold`) — that translation happens at exactly one boundary.
- No GitLab changes, no dashboard changes (both explicitly out of scope per the spec).

---

### Task 1: `NoiseDecision` model + additive noise fields on `ReviewComment`/`FileReview`

**Files:**
- Modify: `packages/agents/src/arete_agents/models/review.py`
- Test: `packages/agents/tests/test_models.py`

**Interfaces:**
- Produces: `NoiseDecision(path: str, line: int, action: Literal["silence", "observe"], reason: str, escalate_on: str | None = None, threshold: int | None = None)`. `ReviewComment` gains `noise_state: Literal["OPEN", "SILENCED", "UNDER_OBSERVATION", "ESCALATED"] = "OPEN"`, `escalate_on: str | None = None`, `threshold: int | None = None`. `FileReview` gains `noise_decisions: list[NoiseDecision] = Field(default_factory=list)`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agents/tests/test_models.py`:

```python
def test_review_comment_noise_fields_default_to_open():
    comment = ReviewComment(
        path="a.py", line=1, body="x", severity="info", category="quality",
    )
    assert comment.noise_state == "OPEN"
    assert comment.escalate_on is None
    assert comment.threshold is None


def test_review_comment_accepts_noise_fields():
    comment = ReviewComment(
        path="a.py", line=1, body="x", severity="info", category="quality",
        noise_state="UNDER_OBSERVATION", escalate_on="additional_events", threshold=3,
    )
    assert comment.noise_state == "UNDER_OBSERVATION"
    assert comment.escalate_on == "additional_events"
    assert comment.threshold == 3


def test_file_review_noise_decisions_defaults_to_empty_list():
    fr = FileReview(path="a.py", comments=[], summary="clean")
    assert fr.noise_decisions == []


def test_noise_decision_model_holds_silence_action():
    from arete_agents.models.review import NoiseDecision

    decision = NoiseDecision(path="a.py", line=5, action="silence", reason="false positive")
    assert decision.action == "silence"
    assert decision.escalate_on is None
    assert decision.threshold is None


def test_noise_decision_model_holds_observe_action():
    from arete_agents.models.review import NoiseDecision

    decision = NoiseDecision(
        path="a.py", line=5, action="observe", reason="maybe flaky",
        escalate_on="additional_events", threshold=3,
    )
    assert decision.action == "observe"
    assert decision.escalate_on == "additional_events"
    assert decision.threshold == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && python -m pytest tests/test_models.py -k noise -v`
Expected: FAIL — `ReviewComment`/`FileReview` reject the unexpected `noise_state`/`escalate_on`/`threshold`/`noise_decisions` keyword arguments (Pydantic raises on unknown fields), and `NoiseDecision` does not exist yet.

- [ ] **Step 3: Implement the model changes**

In `packages/agents/src/arete_agents/models/review.py`, change:

```python
from typing import Literal

from pydantic import BaseModel, computed_field

from arete_agents.models.pr import PRContext


class ReviewComment(BaseModel):
    path: str
    line: int
    body: str
    severity: Literal["info", "warning", "error"]
    category: str


class FileReview(BaseModel):
    path: str
    comments: list[ReviewComment]
    summary: str
```

to:

```python
from typing import Literal

from pydantic import BaseModel, Field, computed_field

from arete_agents.models.pr import PRContext


class NoiseDecision(BaseModel):
    """A silence_as_noise/place_under_observation tool call recorded during
    review_file()'s tool loop (see agents/base.py). issue_id is parsed into
    path/line before this model is built. escalate_on/threshold are only
    meaningful for action="observe" -- silence carries no threshold."""
    path: str
    line: int
    action: Literal["silence", "observe"]
    reason: str
    escalate_on: str | None = None
    threshold: int | None = None


class ReviewComment(BaseModel):
    path: str
    line: int
    body: str
    severity: Literal["info", "warning", "error"]
    category: str
    # Noise Classification (SP6). Defaults keep every existing constructor
    # call across the test suite working unchanged. Stamped deterministically
    # by ReviewOrchestrator._apply_noise_decisions AFTER synthesis -- never
    # set directly from the LLM's own JSON output.
    noise_state: Literal["OPEN", "SILENCED", "UNDER_OBSERVATION", "ESCALATED"] = "OPEN"
    escalate_on: str | None = None
    threshold: int | None = None


class FileReview(BaseModel):
    path: str
    comments: list[ReviewComment]
    summary: str
    # Tool calls recorded during this file's review_file() tool loop (see
    # agents/base.py). Consumed by orchestrator.py's GraphState reducer and
    # discarded after _synthesize_reviews applies them -- never serialized
    # onward as part of the public ReviewResult.
    noise_decisions: list[NoiseDecision] = Field(default_factory=list)
```

Leave `ReviewResult` (further down in the same file) untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && python -m pytest tests/test_models.py -v`
Expected: all pass, including the new noise tests and every pre-existing test in the file (additive fields must not break `test_review_comment_rejects_invalid_severity`, `test_review_result_computes_total_comments`, etc.).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/models/review.py packages/agents/tests/test_models.py
git commit -m "feat(agents): add NoiseDecision model and additive noise fields to ReviewComment/FileReview"
```

---

### Task 2: Record `silence_as_noise`/`place_under_observation` calls in `review_file()`

**Files:**
- Modify: `packages/agents/src/arete_agents/agents/base.py`
- Test: `packages/agents/tests/test_agents.py`

**Interfaces:**
- Consumes: `NoiseDecision` from Task 1 (`arete_agents.models.review`).
- Produces: `review_file()`'s public return type is unchanged (`FileReview`) — every existing caller and the 20+ existing tests in `test_agents.py` that call `agent.review_file(...)` keep working with zero changes. The returned `FileReview.noise_decisions` is now populated from any `silence_as_noise`/`place_under_observation` tool calls made during this file's review.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agents/tests/test_agents.py`:

```python
def test_review_file_records_silence_as_noise_decision():
    from arete_agents.agents.security import SecurityAgent

    llm = MagicMock()
    llm.bind_tools.return_value = llm
    llm.with_retry.return_value = llm
    llm.invoke.side_effect = [
        AIMessage(content="", tool_calls=[
            {
                "name": "silence_as_noise",
                "args": {"issue_id": "src/auth.py:5", "reason": "intended behavior"},
                "id": "c1",
            }
        ]),
        AIMessage(content='{"comments": [], "summary": "reviewed"}'),
    ]

    result = SecurityAgent(llm).review_file(make_file(), make_pr())

    assert len(result.noise_decisions) == 1
    decision = result.noise_decisions[0]
    assert decision.path == "src/auth.py"
    assert decision.line == 5
    assert decision.action == "silence"
    assert decision.reason == "intended behavior"


def test_review_file_records_place_under_observation_decision():
    from arete_agents.agents.security import SecurityAgent

    llm = MagicMock()
    llm.bind_tools.return_value = llm
    llm.with_retry.return_value = llm
    llm.invoke.side_effect = [
        AIMessage(content="", tool_calls=[
            {
                "name": "place_under_observation",
                "args": {
                    "issue_id": "src/auth.py:5",
                    "escalate_on": "additional_events",
                    "threshold": 3,
                    "reason": "suspicious but unproven",
                },
                "id": "c1",
            }
        ]),
        AIMessage(content='{"comments": [], "summary": "reviewed"}'),
    ]

    result = SecurityAgent(llm).review_file(make_file(), make_pr())

    assert len(result.noise_decisions) == 1
    decision = result.noise_decisions[0]
    assert decision.action == "observe"
    assert decision.escalate_on == "additional_events"
    assert decision.threshold == 3


def test_review_file_ignores_malformed_issue_id():
    """A tool call whose issue_id has no ':' (can't be parsed into path/line)
    must not raise -- it's simply dropped, matching this codebase's fail-open
    posture for malformed LLM tool output."""
    from arete_agents.agents.security import SecurityAgent

    llm = MagicMock()
    llm.bind_tools.return_value = llm
    llm.with_retry.return_value = llm
    llm.invoke.side_effect = [
        AIMessage(content="", tool_calls=[
            {
                "name": "silence_as_noise",
                "args": {"issue_id": "not-a-path-and-line", "reason": "x"},
                "id": "c1",
            }
        ]),
        AIMessage(content='{"comments": [], "summary": "reviewed"}'),
    ]

    result = SecurityAgent(llm).review_file(make_file(), make_pr())

    assert result.noise_decisions == []


def test_review_file_without_noise_tool_calls_has_empty_decisions():
    from arete_agents.agents.security import SecurityAgent

    mock_llm = make_mock_llm('{"comments": [], "summary": "clean"}')
    result = SecurityAgent(mock_llm).review_file(make_file(), make_pr())
    assert result.noise_decisions == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && python -m pytest tests/test_agents.py -k noise -v`
Expected: FAIL — `result.noise_decisions` is `[]` in the silence/observe tests (nothing records the tool call yet); the malformed/no-tool-call tests already pass trivially since `noise_decisions` defaults to `[]` from Task 1, so run the first two to confirm the real failure.

- [ ] **Step 3: Implement the tool-loop recording**

In `packages/agents/src/arete_agents/agents/base.py`, change the import line:

```python
from arete_agents.models.review import FileReview, ReviewComment
```

to:

```python
from arete_agents.models.review import FileReview, NoiseDecision, ReviewComment
```

Then change the tool-execution loop and final return inside `review_file()` — from:

```python
        # Tool execution loop
        from langchain_core.messages import ToolMessage
        
        rounds = 0
        while True:
            response = llm_with_retry.invoke(messages)

            # If the LLM didn't request any tools, it's done reviewing
            if not response.tool_calls:
                break

            rounds += 1
            if rounds > MAX_TOOL_ROUNDS:
                logging.warning(
                    f"{self.agent_name} exceeded {MAX_TOOL_ROUNDS} tool-call "
                    f"rounds reviewing {file.path}; stopping and parsing the "
                    "last response as-is."
                )
                break

            # The LLM wants to use an MCP tool, so we append its request to the history
            messages.append(response)
            
            # Execute each requested tool
            for tool_call in response.tool_calls:
                tool_name = tool_call["name"]
                tool_args = tool_call["args"]
                
                # Find the actual tool function from our loaded mcp_tools
                tool_instance = next((t for t in mcp_tools if t.name == tool_name), None)
                
                if tool_instance:
                    try:
                        # Execute the tool and get the string result
                        result = tool_instance.invoke(tool_args)
                    except Exception as e:
                        result = f"Error executing tool: {e}"
                else:
                    result = f"Error: Tool '{tool_name}' not found."
                    
                # Append the tool's result back to the messages so the LLM can read it
                messages.append(ToolMessage(content=str(result), tool_call_id=tool_call["id"]))
        
        # Once the loop exits, response.content holds the final JSON
        raw = response.content if isinstance(response.content, str) else ""
        comments, summary = self._parse_response(file.path, raw)
        return FileReview(path=file.path, comments=comments, summary=summary)
```

to:

```python
        # Tool execution loop
        from langchain_core.messages import ToolMessage

        noise_decisions: list[NoiseDecision] = []
        rounds = 0
        while True:
            response = llm_with_retry.invoke(messages)

            # If the LLM didn't request any tools, it's done reviewing
            if not response.tool_calls:
                break

            rounds += 1
            if rounds > MAX_TOOL_ROUNDS:
                logging.warning(
                    f"{self.agent_name} exceeded {MAX_TOOL_ROUNDS} tool-call "
                    f"rounds reviewing {file.path}; stopping and parsing the "
                    "last response as-is."
                )
                break

            # The LLM wants to use an MCP tool, so we append its request to the history
            messages.append(response)
            
            # Execute each requested tool
            for tool_call in response.tool_calls:
                tool_name = tool_call["name"]
                tool_args = tool_call["args"]

                if tool_name in ("silence_as_noise", "place_under_observation"):
                    decision = self._record_noise_decision(tool_name, tool_args)
                    if decision is not None:
                        noise_decisions.append(decision)

                # Find the actual tool function from our loaded mcp_tools
                tool_instance = next((t for t in mcp_tools if t.name == tool_name), None)
                
                if tool_instance:
                    try:
                        # Execute the tool and get the string result
                        result = tool_instance.invoke(tool_args)
                    except Exception as e:
                        result = f"Error executing tool: {e}"
                else:
                    result = f"Error: Tool '{tool_name}' not found."
                    
                # Append the tool's result back to the messages so the LLM can read it
                messages.append(ToolMessage(content=str(result), tool_call_id=tool_call["id"]))
        
        # Once the loop exits, response.content holds the final JSON
        raw = response.content if isinstance(response.content, str) else ""
        comments, summary = self._parse_response(file.path, raw)
        return FileReview(
            path=file.path,
            comments=comments,
            summary=summary,
            noise_decisions=noise_decisions,
        )

    @staticmethod
    def _record_noise_decision(tool_name: str, tool_args: dict) -> "NoiseDecision | None":
        """Parses a silence_as_noise/place_under_observation tool call's
        issue_id ("path:line") into a NoiseDecision. Returns None for a
        malformed issue_id instead of raising -- a bad tool call must never
        break the review, matching _parse_response's fail-open posture."""
        issue_id = tool_args.get("issue_id", "")
        path, sep, line_str = issue_id.rpartition(":")
        if not sep:
            return None
        try:
            line = int(line_str)
        except ValueError:
            return None

        if tool_name == "silence_as_noise":
            return NoiseDecision(
                path=path,
                line=line,
                action="silence",
                reason=tool_args.get("reason", ""),
            )
        return NoiseDecision(
            path=path,
            line=line,
            action="observe",
            reason=tool_args.get("reason", ""),
            escalate_on=tool_args.get("escalate_on"),
            threshold=tool_args.get("threshold"),
        )
```

Note: `_record_noise_decision` is added as a new method on `BaseReviewAgent` (the class `review_file` belongs to), placed immediately after `review_file`'s closing `return`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && python -m pytest tests/test_agents.py -v`
Expected: all pass, including every pre-existing `review_file`-calling test in the file (they never inspect `noise_decisions`, so the additive field has no effect on them) and the 4 new noise tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/arete_agents/agents/base.py packages/agents/tests/test_agents.py
git commit -m "feat(agents): record silence_as_noise/place_under_observation tool calls in review_file()"
```

---

### Task 3: Thread `noise_decisions` through the orchestrator and stamp comments after synthesis

**Files:**
- Modify: `packages/agents/src/arete_agents/orchestrator.py`
- Test: `packages/agents/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `FileReview.noise_decisions` (Task 1/2).
- Produces: `ReviewOrchestrator._apply_noise_decisions(result: ReviewResult, decisions: list[NoiseDecision]) -> ReviewResult` (new private method, same style as the existing `_apply_critic`/`_apply_grounding`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/agents/tests/test_orchestrator.py`:

```python
def test_apply_noise_decisions_silences_matching_comment():
    from arete_agents.models.review import NoiseDecision
    from arete_agents.orchestrator import ReviewOrchestrator

    result = _grounding_result([
        ReviewComment(path="src/auth.py", line=5, body="x", severity="info", category="quality"),
    ])
    orch = ReviewOrchestrator(llm=MagicMock())
    out = orch._apply_noise_decisions(
        result,
        [NoiseDecision(path="src/auth.py", line=5, action="silence", reason="fp")],
    )
    assert out.file_reviews[0].comments[0].noise_state == "SILENCED"


def test_apply_noise_decisions_observes_matching_comment():
    from arete_agents.models.review import NoiseDecision
    from arete_agents.orchestrator import ReviewOrchestrator

    result = _grounding_result([
        ReviewComment(path="src/auth.py", line=5, body="x", severity="info", category="quality"),
    ])
    orch = ReviewOrchestrator(llm=MagicMock())
    out = orch._apply_noise_decisions(
        result,
        [NoiseDecision(
            path="src/auth.py", line=5, action="observe", reason="watch",
            escalate_on="additional_events", threshold=3,
        )],
    )
    comment = out.file_reviews[0].comments[0]
    assert comment.noise_state == "UNDER_OBSERVATION"
    assert comment.escalate_on == "additional_events"
    assert comment.threshold == 3


def test_apply_noise_decisions_no_match_is_a_noop():
    from arete_agents.models.review import NoiseDecision
    from arete_agents.orchestrator import ReviewOrchestrator

    result = _grounding_result([
        ReviewComment(path="src/auth.py", line=5, body="x", severity="info", category="quality"),
    ])
    orch = ReviewOrchestrator(llm=MagicMock())
    out = orch._apply_noise_decisions(
        result,
        [NoiseDecision(path="src/other.py", line=99, action="silence", reason="fp")],
    )
    assert out.file_reviews[0].comments[0].noise_state == "OPEN"


def test_apply_noise_decisions_empty_list_is_a_noop():
    from arete_agents.orchestrator import ReviewOrchestrator

    result = _grounding_result([
        ReviewComment(path="src/auth.py", line=5, body="x", severity="info", category="quality"),
    ])
    orch = ReviewOrchestrator(llm=MagicMock())
    out = orch._apply_noise_decisions(result, [])
    assert out.file_reviews[0].comments[0].noise_state == "OPEN"


def test_execute_agent_review_propagates_noise_decisions(sample_pr):
    from arete_agents.orchestrator import ReviewOrchestrator, ReviewTaskState

    llm = MagicMock()
    llm.bind_tools.return_value = llm
    llm.with_retry.return_value = llm
    llm.invoke.side_effect = [
        AIMessage(content="", tool_calls=[{
            "name": "silence_as_noise",
            "args": {"issue_id": "src/auth.py:5", "reason": "fp"},
            "id": "c1",
        }]),
        AIMessage(content='{"comments": [], "summary": "done"}'),
    ]

    orch = ReviewOrchestrator(llm=llm)
    state = ReviewTaskState(pr=sample_pr, file=sample_pr.files[0], agent_name="SecurityAgent")
    update = orch._execute_agent_review(state)

    assert len(update["noise_decisions"]) == 1
    assert update["noise_decisions"][0].action == "silence"


def test_synthesize_reviews_applies_noise_decisions_from_state(sample_pr):
    from arete_agents.llm.base import ROLE_KEYS
    from arete_agents.models.review import FileReview, NoiseDecision
    from arete_agents.orchestrator import ReviewOrchestrator

    synth_response = (
        '{"file_reviews": [{"path": "src/auth.py", "comments": '
        '[{"path": "src/auth.py", "line": 5, "body": "Noisy.", '
        '"severity": "info", "category": "quality"}], "summary": "s"}], '
        '"overall_summary": "s", "risk_level": "low", "dropped_count": 0}'
    )
    synth_llm = MagicMock()
    synth_llm.with_retry.return_value = synth_llm
    synth_llm.invoke.return_value = AIMessage(content=synth_response)

    llms = {role: MagicMock() for role in ROLE_KEYS}
    llms["synthesizer"] = synth_llm

    orch = ReviewOrchestrator(llm=llms)
    raw = [FileReview(path="src/auth.py", comments=[], summary="s")]
    state = {
        "pr": sample_pr,
        "raw_reviews": raw,
        "noise_decisions": [
            NoiseDecision(path="src/auth.py", line=5, action="silence", reason="fp"),
        ],
        "agent_successes": 1,
        "agent_failures": 0,
    }
    update = orch._synthesize_reviews(state)

    comment = update["final_result"].file_reviews[0].comments[0]
    assert comment.noise_state == "SILENCED"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents && python -m pytest tests/test_orchestrator.py -k noise -v`
Expected: FAIL — `_apply_noise_decisions` does not exist yet; `_execute_agent_review`'s returned dict has no `noise_decisions` key; `_synthesize_reviews` never stamps anything.

- [ ] **Step 3: Implement the orchestrator wiring**

In `packages/agents/src/arete_agents/orchestrator.py`, change the model import:

```python
from arete_agents.models.review import FileReview, ReviewResult
```

to:

```python
from arete_agents.models.review import FileReview, NoiseDecision, ReviewResult
```

Change the `GraphState` TypedDict from:

```python
class GraphState(TypedDict):
    pr: PRContext
    raw_reviews: Annotated[list[FileReview], operator.add]
    # Explicit success/failure tallies from the fan-out, so "all agents
    # errored" can be detected deterministically instead of pattern-matching
    # error text in FileReview summaries after the fact.
    agent_successes: Annotated[int, operator.add]
    agent_failures: Annotated[int, operator.add]
    final_result: ReviewResult
```

to:

```python
class GraphState(TypedDict):
    pr: PRContext
    raw_reviews: Annotated[list[FileReview], operator.add]
    # Tool calls recorded across every agent's review_file() run this PR
    # (see agents/base.py). Applied to the synthesized result in
    # _synthesize_reviews, after the critic/grounding gates.
    noise_decisions: Annotated[list[NoiseDecision], operator.add]
    # Explicit success/failure tallies from the fan-out, so "all agents
    # errored" can be detected deterministically instead of pattern-matching
    # error text in FileReview summaries after the fact.
    agent_successes: Annotated[int, operator.add]
    agent_failures: Annotated[int, operator.add]
    final_result: ReviewResult
```

Change `_execute_agent_review`'s success path from:

```python
        try:
            result = agent.review_file(file, pr)
            return {"raw_reviews": [result], "agent_successes": 1}
        except Exception as exc:
```

to:

```python
        try:
            result = agent.review_file(file, pr)
            return {
                "raw_reviews": [result],
                "noise_decisions": result.noise_decisions,
                "agent_successes": 1,
            }
        except Exception as exc:
```

(The `if not agent:` and `except Exception` branches are unchanged — they have no noise decisions to report, and omitting the key from a partial LangGraph node update is a no-op for the `operator.add` reducer.)

In `_synthesize_reviews`, change:

```python
        final_result = self._apply_critic(pr, final_result)
        final_result = self._apply_grounding(pr, final_result)

        # "failed" only when every agent errored (total outage) -- partial
```

to:

```python
        final_result = self._apply_critic(pr, final_result)
        final_result = self._apply_grounding(pr, final_result)
        final_result = self._apply_noise_decisions(final_result, state.get("noise_decisions", []))

        # "failed" only when every agent errored (total outage) -- partial
```

Add the new method immediately after `_apply_grounding`'s closing `return result` (before `def run(self, pr: PRContext) -> ReviewResult:`):

```python
    def _apply_noise_decisions(
        self, result: ReviewResult, decisions: list[NoiseDecision]
    ) -> ReviewResult:
        """Deterministic post-synthesis stamp: for every recorded
        silence_as_noise/place_under_observation tool call (see
        agents/base.py's review_file()), find the surviving comment at the
        same (path, line) and set its noise_state accordingly. A decision
        with no matching surviving comment (e.g. the finding was dropped by
        the critic or grounding gates) is silently a no-op -- same posture as
        dropped_count/critic_dropped_count for comments that don't survive."""
        if not decisions:
            return result

        by_key = {(d.path, d.line): d for d in decisions}
        for fr in result.file_reviews:
            for c in fr.comments:
                decision = by_key.get((c.path, c.line))
                if decision is None:
                    continue
                if decision.action == "silence":
                    c.noise_state = "SILENCED"
                else:
                    c.noise_state = "UNDER_OBSERVATION"
                    c.escalate_on = decision.escalate_on
                    c.threshold = decision.threshold
        return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && python -m pytest tests/test_orchestrator.py -v`
Expected: all pass, including every pre-existing test in the file (the additive `GraphState` key and the new stamping step run only when `noise_decisions` is non-empty, so a run with none is unaffected).

- [ ] **Step 5: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && python -m pytest --ignore=tests/test_e2e_smoke.py -q`
Expected: same pass count as before this task plus the new tests from Tasks 1-3; no new failures.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/orchestrator.py packages/agents/tests/test_orchestrator.py
git commit -m "feat(agents): thread noise_decisions through GraphState and stamp comments after synthesis"
```

---

### Task 4: `occurrenceCount` schema addition

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260714120000_add_review_comment_occurrence_count/migration.sql`

**Interfaces:**
- Produces: `ReviewComment.occurrenceCount: Int @default(1)` column, available to `packages/webhook/src/persistence.ts` via the generated Prisma client.

- [ ] **Step 1: Modify the schema**

In `packages/db/prisma/schema.prisma`, change the `ReviewComment` model from:

```prisma
model ReviewComment {
  id               String   @id @default(uuid())
  reviewId         String
  path             String
  line             Int
  body             String
  severity         String
  category         String
  
  // Noise Classification Fields
  noiseState       String   @default("OPEN") // "OPEN", "SILENCED", "UNDER_OBSERVATION"
  escalateOn       String?  // "events_per_minute", "additional_events"
  threshold        Int?     // Threshold value for escalation
  
  createdAt        DateTime @default(now())
  review           Review   @relation(fields: [reviewId], references: [id])
}
```

to:

```prisma
model ReviewComment {
  id               String   @id @default(uuid())
  reviewId         String
  path             String
  line             Int
  body             String
  severity         String
  category         String
  
  // Noise Classification Fields
  noiseState       String   @default("OPEN") // "OPEN", "SILENCED", "UNDER_OBSERVATION", "ESCALATED"
  escalateOn       String?  // "events_per_minute", "additional_events"
  threshold        Int?     // Threshold value for escalation
  occurrenceCount  Int      @default(1) // Times a matching (repo, path, category) issue has recurred while UNDER_OBSERVATION
  
  createdAt        DateTime @default(now())
  review           Review   @relation(fields: [reviewId], references: [id])
}
```

- [ ] **Step 2: Write the migration file**

Create `packages/db/prisma/migrations/20260714120000_add_review_comment_occurrence_count/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "ReviewComment" ADD COLUMN "occurrenceCount" INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 3: Regenerate the Prisma client and verify it compiles**

Run: `cd packages/db && pnpm run generate`
Expected: succeeds — `prisma generate` only needs the schema file to parse, not a live database connection.

Run: `cd packages/db && pnpm run lint`
Expected: `tsc -p tsconfig.json --noEmit` succeeds with no errors, confirming the regenerated client's types are consistent with the rest of the package.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260714120000_add_review_comment_occurrence_count/migration.sql
git commit -m "feat(db): add ReviewComment.occurrenceCount for cross-PR noise escalation"
```

---

### Task 5: Persist noise state and run recurrence-based escalation in `persistReview`

**Files:**
- Modify: `packages/webhook/src/types.ts`
- Modify: `packages/webhook/src/persistence.ts`
- Test: `packages/webhook/src/persistence.test.ts`

**Interfaces:**
- Consumes: `ReviewComment.occurrenceCount` column from Task 4 (via the regenerated `@arete/db` Prisma client).
- Produces: `persistReview` now writes `noiseState`/`escalateOn`/`threshold` onto every created `ReviewComment` row (translated from the incoming wire-format `ReviewComment.noise_state`/`escalate_on`/`threshold`), and increments/escalates a matching prior `UNDER_OBSERVATION` row before creating this review's own comments.

- [ ] **Step 1: Add the missing wire-format fields to the TS type**

In `packages/webhook/src/types.ts`, change the `ReviewComment` interface from:

```ts
export interface ReviewComment {
  path: string
  line: number
  body: string
  severity: 'info' | 'warning' | 'error'
  category: string
}
```

to:

```ts
export interface ReviewComment {
  path: string
  line: number
  body: string
  severity: 'info' | 'warning' | 'error'
  category: string
  // Noise Classification (SP6). Snake_case: the Python agents service emits
  // these field names unchanged over the wire, exactly like risk_level/
  // overall_summary/pr_context elsewhere on ReviewResult -- NOT translated
  // to camelCase here. persistence.ts's persistReview is the one place that
  // translates to the Prisma schema's camelCase columns.
  noise_state?: 'OPEN' | 'SILENCED' | 'UNDER_OBSERVATION' | 'ESCALATED'
  escalate_on?: string | null
  threshold?: number | null
}
```

- [ ] **Step 2: Write the failing tests**

Read `packages/webhook/src/persistence.test.ts` first to confirm its exact current `makePrismaMock()`/`loadPersistence()` helpers (they currently stub `installation`, `telemetrySnapshotRecord`, `repository`, `agentMemory` — no `review` or `reviewComment` mock exists yet, since `persistReview` has so far only been exercised indirectly through `pipeline.integration.test.ts`'s own separate mock factory).

Extend `makePrismaMock()` from:

```ts
function makePrismaMock() {
  const installationFindUnique = vi.fn()
  const installationUpsert = vi.fn()
  const telemetrySnapshotRecordUpsert = vi.fn()
  const repositoryFindUnique = vi.fn()
  const agentMemoryFindMany = vi.fn()

  class PrismaClient {
    installation = { findUnique: installationFindUnique, upsert: installationUpsert }
    telemetrySnapshotRecord = { upsert: telemetrySnapshotRecordUpsert }
    repository = { findUnique: repositoryFindUnique }
    agentMemory = { findMany: agentMemoryFindMany }
  }

  return {
    PrismaClient,
    installationFindUnique,
    installationUpsert,
    telemetrySnapshotRecordUpsert,
    repositoryFindUnique,
    agentMemoryFindMany,
  }
}
```

to:

```ts
function makePrismaMock() {
  const installationFindUnique = vi.fn()
  const installationUpsert = vi.fn()
  const installationUpdate = vi.fn()
  const telemetrySnapshotRecordUpsert = vi.fn()
  const repositoryFindUnique = vi.fn()
  const repositoryUpsert = vi.fn()
  const reviewFindUnique = vi.fn()
  const reviewCreate = vi.fn()
  const reviewCommentFindFirst = vi.fn()
  const reviewCommentUpdate = vi.fn()
  const agentMemoryFindMany = vi.fn()

  class PrismaClient {
    installation = {
      findUnique: installationFindUnique,
      upsert: installationUpsert,
      update: installationUpdate,
    }
    telemetrySnapshotRecord = { upsert: telemetrySnapshotRecordUpsert }
    repository = { findUnique: repositoryFindUnique, upsert: repositoryUpsert }
    review = { findUnique: reviewFindUnique, create: reviewCreate }
    reviewComment = { findFirst: reviewCommentFindFirst, update: reviewCommentUpdate }
    agentMemory = { findMany: agentMemoryFindMany }
  }

  return {
    PrismaClient,
    installationFindUnique,
    installationUpsert,
    installationUpdate,
    telemetrySnapshotRecordUpsert,
    repositoryFindUnique,
    repositoryUpsert,
    reviewFindUnique,
    reviewCreate,
    reviewCommentFindFirst,
    reviewCommentUpdate,
    agentMemoryFindMany,
  }
}
```

Then append this new `describe` block at the end of the file (after `describe('fetchProjectMemories', ...)`):

```ts
describe('persistReview', () => {
  let mocks: ReturnType<typeof makePrismaMock>

  const BASE_PARAMS = {
    provider: 'github' as const,
    installationExternalId: 1,
    repositoryExternalId: 1,
    owner: 'acme',
    name: 'api',
    fullName: 'acme/api',
    prNumber: 1,
    headSha: 'sha1',
  }

  function makeResult(comments: any[]) {
    return {
      pr_context: {} as any,
      file_reviews: comments.length
        ? [{ path: comments[0].path, comments, summary: 's' }]
        : [],
      overall_summary: 'ok',
      risk_level: 'low' as const,
      total_comments: comments.length,
    }
  }

  beforeEach(() => {
    mocks = makePrismaMock()
    mocks.installationUpsert.mockResolvedValue({ id: 'inst-uuid-1' })
    mocks.repositoryUpsert.mockResolvedValue({ id: 'repo-uuid-1' })
    mocks.reviewFindUnique.mockResolvedValue(null)
    mocks.reviewCreate.mockResolvedValue({ id: 'review-uuid-1' })
    mocks.reviewCommentFindFirst.mockResolvedValue(null)
  })

  it('writes noiseState/escalateOn/threshold from the comment data onto each created row', async () => {
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([{
        path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality',
        noise_state: 'SILENCED', escalate_on: null, threshold: null,
      }]),
    })

    const createArgs = mocks.reviewCreate.mock.calls[0][0]
    expect(createArgs.data.comments.createMany.data[0]).toMatchObject({
      noiseState: 'SILENCED',
      escalateOn: null,
      threshold: null,
    })
  })

  it('defaults noiseState to OPEN when the comment carries no noise fields', async () => {
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([
        { path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality' },
      ]),
    })

    const createArgs = mocks.reviewCreate.mock.calls[0][0]
    expect(createArgs.data.comments.createMany.data[0].noiseState).toBe('OPEN')
  })

  it('creates a fresh row with no recurrence check when there is no prior UNDER_OBSERVATION match', async () => {
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([{
        path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality',
        noise_state: 'UNDER_OBSERVATION', escalate_on: 'additional_events', threshold: 3,
      }]),
    })

    expect(mocks.reviewCommentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          noiseState: 'UNDER_OBSERVATION',
          path: 'src/auth.py',
          category: 'quality',
          review: { repositoryId: 'repo-uuid-1' },
        },
      })
    )
    expect(mocks.reviewCommentUpdate).not.toHaveBeenCalled()
  })

  it('increments occurrenceCount on a matching prior UNDER_OBSERVATION comment', async () => {
    mocks.reviewCommentFindFirst.mockResolvedValue({
      id: 'comment-uuid-1', occurrenceCount: 1, threshold: 3,
    })
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([{
        path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality',
        noise_state: 'UNDER_OBSERVATION', escalate_on: 'additional_events', threshold: 3,
      }]),
    })

    expect(mocks.reviewCommentUpdate).toHaveBeenCalledWith({
      where: { id: 'comment-uuid-1' },
      data: { occurrenceCount: 2, noiseState: 'UNDER_OBSERVATION' },
    })
  })

  it('escalates to ESCALATED once the incremented count reaches the threshold', async () => {
    mocks.reviewCommentFindFirst.mockResolvedValue({
      id: 'comment-uuid-1', occurrenceCount: 2, threshold: 3,
    })
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([{
        path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality',
        noise_state: 'UNDER_OBSERVATION', escalate_on: 'additional_events', threshold: 3,
      }]),
    })

    expect(mocks.reviewCommentUpdate).toHaveBeenCalledWith({
      where: { id: 'comment-uuid-1' },
      data: { occurrenceCount: 3, noiseState: 'ESCALATED' },
    })
  })

  it('does not run a recurrence check for OPEN/SILENCED comments', async () => {
    const { persistReview } = await loadPersistence(mocks)

    await persistReview({
      ...BASE_PARAMS,
      result: makeResult([{
        path: 'src/auth.py', line: 5, body: 'x', severity: 'info', category: 'quality',
        noise_state: 'SILENCED',
      }]),
    })

    expect(mocks.reviewCommentFindFirst).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook test persistence -- -t "persistReview"`
Expected: FAIL — `persistReview` doesn't write `noiseState`/`escalateOn`/`threshold` yet, and never calls `reviewComment.findFirst`/`update`.

- [ ] **Step 4: Implement the persistence + escalation logic**

In `packages/webhook/src/persistence.ts`, change `persistReview`'s body — from:

```ts
  const existing = await prisma.review.findUnique({
    where: {
      repositoryId_prNumber_headSha: { repositoryId: repository.id, prNumber, headSha },
    },
  })
  if (existing) {
    console.log(
      `[persistence] Review for ${fullName}#${prNumber} @ ${headSha} already exists — skipping duplicate`
    )
    return
  }

  await prisma.review.create({
    data: {
      prNumber,
      repositoryId: repository.id,
      riskLevel: result.risk_level,
      overallSummary: result.overall_summary,
      headSha,
      analysisStatus: result.analysis_status ?? 'complete',
      comments: {
        createMany: {
          data: result.file_reviews.flatMap((fr) =>
            fr.comments.map((c) => ({
              path: fr.path,
              line: c.line,
              body: c.body,
              severity: c.severity,
              category: c.category,
            }))
          ),
        },
      },
    },
  })

  await prisma.installation.update({
    where: { id: installation.id },
    data: { usageCount: { increment: 1 } },
  })
}
```

to:

```ts
  const existing = await prisma.review.findUnique({
    where: {
      repositoryId_prNumber_headSha: { repositoryId: repository.id, prNumber, headSha },
    },
  })
  if (existing) {
    console.log(
      `[persistence] Review for ${fullName}#${prNumber} @ ${headSha} already exists — skipping duplicate`
    )
    return
  }

  const commentsToCreate = result.file_reviews.flatMap((fr) =>
    fr.comments.map((c) => ({
      path: fr.path,
      line: c.line,
      body: c.body,
      severity: c.severity,
      category: c.category,
      noiseState: c.noise_state ?? 'OPEN',
      escalateOn: c.escalate_on ?? null,
      threshold: c.threshold ?? null,
    }))
  )

  // Noise Classification escalation (SP6): before creating this review's own
  // comments, check whether any newly-observed issue recurs against a PRIOR
  // review's still-UNDER_OBSERVATION comment on this same repo. Matching key
  // is deliberately simple -- (repository, path, category) -- no semantic
  // similarity. This runs inline here (not in a standalone worker) because
  // "a new review just completed" is the only real trigger point this
  // product has for recurrence, and this repo has no deployment/cron
  // infrastructure for a separate scheduled process.
  for (const c of commentsToCreate) {
    if (c.noiseState !== 'UNDER_OBSERVATION') continue

    const priorObserved = await prisma.reviewComment.findFirst({
      where: {
        noiseState: 'UNDER_OBSERVATION',
        path: c.path,
        category: c.category,
        review: { repositoryId: repository.id },
      },
    })
    if (!priorObserved) continue

    const newCount = priorObserved.occurrenceCount + 1
    const crossedThreshold =
      priorObserved.threshold !== null && newCount >= priorObserved.threshold

    await prisma.reviewComment.update({
      where: { id: priorObserved.id },
      data: {
        occurrenceCount: newCount,
        noiseState: crossedThreshold ? 'ESCALATED' : 'UNDER_OBSERVATION',
      },
    })
  }

  await prisma.review.create({
    data: {
      prNumber,
      repositoryId: repository.id,
      riskLevel: result.risk_level,
      overallSummary: result.overall_summary,
      headSha,
      analysisStatus: result.analysis_status ?? 'complete',
      comments: {
        createMany: { data: commentsToCreate },
      },
    },
  })

  await prisma.installation.update({
    where: { id: installation.id },
    data: { usageCount: { increment: 1 } },
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook test persistence -v`
Expected: all pass, including every pre-existing test in the file.

- [ ] **Step 6: Run the full webhook suite to confirm no regressions**

Run: `pnpm --filter @arete/webhook test`
Expected: same pass count as before this task plus the new tests; the one pre-existing unrelated `webhook-handler.test.ts` async-handoff failure (present on `main` before this branch existed) is the only failure, unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/webhook/src/types.ts packages/webhook/src/persistence.ts packages/webhook/src/persistence.test.ts
git commit -m "feat(webhook): persist noise state and run recurrence-based escalation in persistReview"
```

---

### Task 6: Exclude non-OPEN comments from the GitHub post

**Files:**
- Modify: `packages/webhook/src/comment-poster.ts`
- Test: `packages/webhook/src/comment-poster.test.ts`

**Interfaces:**
- Consumes: `ReviewComment.noise_state` (Task 5's `types.ts` addition).
- Produces: no signature change to `postReview` — its posted-comment set is now filtered.

- [ ] **Step 1: Write the failing tests**

Append to `packages/webhook/src/comment-poster.test.ts` (inside the existing `describe('postReview', ...)` block, after the existing `it` cases):

```ts
  it('excludes SILENCED comments from the GitHub post', async () => {
    const result: ReviewResult = {
      ...MOCK_RESULT,
      file_reviews: [{
        path: 'src/auth.py',
        comments: [
          { path: 'src/auth.py', line: 5, body: 'SQL injection risk.', severity: 'error', category: 'security' },
          { path: 'src/auth.py', line: 8, body: 'Known false positive.', severity: 'info', category: 'quality', noise_state: 'SILENCED' },
        ],
        summary: 'Mixed findings.',
      }],
    }
    const createReview = vi.fn().mockResolvedValue({})
    await postReview(makeOctokit(createReview) as any, 'acme', 'api', 1, result)
    const call = createReview.mock.calls[0][0]
    expect(call.comments).toHaveLength(1)
    expect(call.comments[0].line).toBe(5)
  })

  it('excludes UNDER_OBSERVATION comments from the GitHub post', async () => {
    const result: ReviewResult = {
      ...MOCK_RESULT,
      file_reviews: [{
        path: 'src/auth.py',
        comments: [
          { path: 'src/auth.py', line: 5, body: 'SQL injection risk.', severity: 'error', category: 'security' },
          {
            path: 'src/auth.py', line: 9, body: 'Maybe flaky.', severity: 'warning', category: 'quality',
            noise_state: 'UNDER_OBSERVATION', escalate_on: 'additional_events', threshold: 3,
          },
        ],
        summary: 'Mixed findings.',
      }],
    }
    const createReview = vi.fn().mockResolvedValue({})
    await postReview(makeOctokit(createReview) as any, 'acme', 'api', 1, result)
    const call = createReview.mock.calls[0][0]
    expect(call.comments).toHaveLength(1)
    expect(call.comments[0].line).toBe(5)
  })

  it('still posts a comment with noise_state explicitly OPEN', async () => {
    const result: ReviewResult = {
      ...MOCK_RESULT,
      file_reviews: [{
        path: 'src/auth.py',
        comments: [
          { path: 'src/auth.py', line: 5, body: 'SQL injection risk.', severity: 'error', category: 'security', noise_state: 'OPEN' },
        ],
        summary: 'One finding.',
      }],
    }
    const createReview = vi.fn().mockResolvedValue({})
    await postReview(makeOctokit(createReview) as any, 'acme', 'api', 1, result)
    expect(createReview.mock.calls[0][0].comments).toHaveLength(1)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook test comment-poster -- -t "noise"`
Expected: FAIL — all comments are currently posted regardless of `noise_state`.

- [ ] **Step 3: Implement the filter**

In `packages/webhook/src/comment-poster.ts`, change:

```ts
  const allComments = result.file_reviews.flatMap((fr) => fr.comments)

  const validComments = allComments
    .filter((c) => c.line >= 1 && c.line <= MAX_VALID_LINE)
```

to:

```ts
  const allComments = result.file_reviews.flatMap((fr) => fr.comments)

  // Noise Classification (SP6): silenced/observed findings are excluded from
  // the GitHub post but still persisted (see persistence.ts's persistReview)
  // -- this is what makes silence_as_noise/place_under_observation's own
  // documented promise ("never posted to GitHub" / "stays quiet until the
  // escalation trigger trips") literally true.
  const openComments = allComments.filter((c) => (c.noise_state ?? 'OPEN') === 'OPEN')

  const validComments = openComments
    .filter((c) => c.line >= 1 && c.line <= MAX_VALID_LINE)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook test comment-poster -v`
Expected: all pass, including the pre-existing tests in the file.

- [ ] **Step 5: Run the full webhook suite to confirm no regressions**

Run: `pnpm --filter @arete/webhook test`
Expected: same pass count as after Task 5 plus 3 new passes; the one pre-existing unrelated failure is unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/webhook/src/comment-poster.ts packages/webhook/src/comment-poster.test.ts
git commit -m "feat(webhook): exclude non-OPEN comments from the GitHub post"
```

---

### Task 7: Retire `noise_escalator.py`

**Files:**
- Delete: `packages/agents/src/arete_agents/noise_escalator.py`

**Interfaces:**
- Consumes: nothing (escalation now runs inline in `persistReview`, Task 5).
- Produces: nothing — this task only removes dead scaffolding.

- [ ] **Step 1: Confirm nothing imports it**

Run: `grep -rn "noise_escalator" packages/agents/src packages/agents/tests`
Expected: no matches (the file is never imported anywhere — it was only ever run standalone via its own `if __name__ == "__main__":` block, which nothing in this repo invokes).

- [ ] **Step 2: Delete the file**

```bash
git rm packages/agents/src/arete_agents/noise_escalator.py
```

- [ ] **Step 3: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && python -m pytest --ignore=tests/test_e2e_smoke.py -q`
Expected: same pass count as after Task 3 (no test ever covered `noise_escalator.py`, since it was pure dead scaffolding with a hardcoded fake array — deleting it removes no tested behavior).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(agents): retire noise_escalator.py -- escalation now runs inline in persistReview (SP6)"
```
