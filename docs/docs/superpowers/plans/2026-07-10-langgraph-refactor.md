# Areté — Refactor: LangGraph Orchestration

**Goal:** Upgrade the Python agent pipeline from a naive `ThreadPoolExecutor` to a formal LangGraph State Machine. This adds a "Synthesizer" step that removes duplicate comments and resolves conflicting agent advice, dramatically improving review quality at the cost of a few extra seconds of latency.

---

## Task 1: Dependencies & Setup

**Files:**
- Modify: `packages/agents/pyproject.toml`

**Implementation:**
1. In `packages/agents`, run `uv add langgraph`.

## Task 2: State & Node Definitions

**Files:**
- Modify: `packages/agents/src/arete_agents/orchestrator.py`

**Implementation:**
1. Define a `GraphState(TypedDict)` with:
   - `pr: PRContext`
   - `raw_reviews: list[FileReview]`
   - `final_result: ReviewResult`
2. Create Node 1: **`run_review_agents(state: GraphState)`**
   - Takes the `state["pr"]` and executes the 6 agents in parallel (using `asyncio.gather` or keeping `ThreadPoolExecutor` internally for this specific fan-out).
   - Returns `{"raw_reviews": combined_results}`
3. Create Node 2: **`synthesize_reviews(state: GraphState)`**
   - Takes the `state["raw_reviews"]`.
   - If `raw_reviews` is empty, returns an empty `ReviewResult`.
   - Otherwise, invokes a new `SynthesizerAgent`. The synthesizer prompt should instruct the LLM to read all the raw comments, remove duplicates, resolve contradictions, and output the final, clean JSON `ReviewResult`.
   - Returns `{"final_result": synthesized_result}`
4. Build the Graph:
   - Add nodes.
   - Add edges: `START -> run_review_agents -> synthesize_reviews -> END`.
   - Compile the graph.

## Task 3: The Circuit Breaker (Fallback)

**Files:**
- Modify: `packages/agents/src/arete_agents/orchestrator.py`

**Implementation:**
1. In `ReviewOrchestrator.run(self, pr: PRContext) -> ReviewResult`:
   - Attempt to invoke the LangGraph graph with a strict 25-second timeout (using `asyncio.wait_for` or similar).
   - If it times out or throws an error, catch the exception, log a warning, and immediately fall back to the old Scatter-Gather logic (merge the results blindly and return them) so the GitHub Webhook never hangs.

## Task 4: Tests & Commit

**Files:**
- Modify: `packages/agents/tests/test_orchestrator.py`

**Implementation:**
1. Ensure the orchestrator tests still pass (you may need to mock the Synthesizer LLM call or test the fallback mechanism).
2. Git commit: "refactor: implement langgraph state machine with synthesizer and circuit breaker"
