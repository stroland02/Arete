# Areté — ADE Feature 2: The Workspace Terminal Agent

**Goal:** Evolve Areté from a static analysis tool into a true Active Agent. The Workspace Agent will have the ability to execute code in a sandboxed environment, run tests, and pipe standard error (`stderr`) logs directly into the LangGraph orchestrator to provide infallible, execution-backed code reviews.

---

## 1. Architectural Blueprint (Docker Sandbox)

We cannot run untrusted user PR code directly on our host infrastructure. The Workspace Agent must orchestrate isolated, ephemeral Docker containers.

**The Flow:**
1. **Trigger:** PR Context is received by the LangGraph.
2. **Setup:** The `WorkspaceAgent` node is invoked *before* the Specialist agents.
3. **Execution:** 
   - It connects to the Docker Daemon via the `docker` Python SDK.
   - It spins up a lightweight container (e.g., `node:20-alpine` or `python:3.12-alpine`).
   - It clones the repository and checks out the specific PR branch.
4. **Validation:** It attempts to run a configured test command (e.g., `npm install && npm run build`).
5. **Synthesis:** It captures the `stdout` and `stderr` logs, terminates the container, and injects those logs into the LangGraph `GraphState`.

## 2. Python Implementation Tasks

**Files:**
- Modify: `packages/agents/pyproject.toml`
- Create: `packages/agents/src/arete_agents/agents/workspace.py`
- Modify: `packages/agents/src/arete_agents/orchestrator.py`

**Implementation:**
1. **Dependencies:** Add `docker` to the Python project: `uv add docker`.
2. **The Agent Class:** Create `WorkspaceAgent(BaseReviewAgent)`. It will contain an `execute(self, repo_url: str, branch: str, command: str) -> str` method.
3. **The LangGraph Node:** Add a new node in `orchestrator.py` called `run_workspace_validation(state)`. 
   - This node runs the `WorkspaceAgent.execute()` method.
   - It updates the `GraphState` with a new key: `build_logs: str`.
4. **The Synthesizer Update:** Inject the `build_logs` into the Synthesizer prompt. 
   - *Prompt addition:* "The code was executed in a sandboxed environment. Here are the build logs: {build_logs}. If there are compiler errors or failing tests, you MUST prioritize reporting them to the user."

## 3. Node.js Webhook Updates (The Trigger)

**Files:**
- Modify: `packages/webhook/src/types.ts`
- Modify: `packages/webhook/src/pr-fetcher.ts`

**Implementation:**
1. To clone the repo, the Workspace Agent needs the repository URL and the branch name. 
2. Update the `PRContext` in Node.js to include `cloneUrl: string` and `branch: string`.
3. Extract these from the GitHub Webhook payload (`pull_request.head.repo.clone_url` and `pull_request.head.ref`) and pass them to the Python backend.

---

Once this is built, Areté will be one of the only Code Review AIs in the world that actually *compiles* your code before telling you it's good.
