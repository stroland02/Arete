# Areté — ADE Feature 2: The CI/CD Diagnostics Agent

**Goal:** Provide execution-backed, autonomous code reviews by listening to GitHub Actions failures, reading the stack traces, and proposing the exact code fix in a PR comment. Zero in-house sandboxing required.

---

## Task 1: Node.js Webhook Updates (The Trigger)

**Files:**
- Modify: `packages/webhook/src/webhook-handler.ts`
- Modify: `packages/webhook/src/pr-fetcher.ts`
- Modify: `packages/webhook/src/types.ts`

**Implementation:**
1. **Webhook Event:** In `webhook-handler.ts`, add a listener for `check_run.completed`.
2. **Logic Check:** If `payload.check_run.conclusion !== "failure"`, ignore it.
3. **Log Fetching:** If it failed, use Octokit to fetch the raw logs for the job (`GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`). Note: The exact API might require parsing annotations, but we can mock or stub the log fetch for the MVP if the API is too complex, just providing the check_run `output.text` or a dummy stack trace.
4. **Context Creation:** Create a modified `PRContext` (or just use the existing one) and attach the `ciLogs: string` to it.
5. **Bridge Invocation:** Call `runReviewPipeline(prContext)` just like a normal PR review, but the Python backend will behave differently.

## Task 2: Python Orchestrator Updates

**Files:**
- Modify: `packages/agents/src/arete_agents/models/pr.py`
- Modify: `packages/agents/src/arete_agents/orchestrator.py`
- Create: `packages/agents/src/arete_agents/agents/ci_agent.py`

**Implementation:**
1. **Model:** Add `ci_logs: str | None = Field(None, alias="ciLogs")` to `PRContext`.
2. **The CI Agent:** Create `CIAgent(BaseReviewAgent)`. Its system prompt will be explicitly designed to act as a Staff DevOps/Software Engineer parsing compiler logs or test suite output. "You are an expert at diagnosing CI/CD build failures. Read these logs, find the file that broke, and provide the exact code fix."
3. **LangGraph Routing:** In `orchestrator.py`, update the Supervisor or the routing logic:
   - If `state["pr"].ci_logs` is present, **DO NOT** run the standard 6 agents.
   - Instead, route the graph exclusively to the `CIAgent`.
   - The `CIAgent` output is then passed to the Synthesizer (or directly returned as the `ReviewResult` with `category: "ci_failure"`).

## Task 3: Commit

1. Ensure the Node tests and Python tests pass.
2. Commit message: `feat: implement CI agent that diagnoses github actions failures`
