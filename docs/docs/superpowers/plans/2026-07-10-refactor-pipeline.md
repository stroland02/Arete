# Areté — Refactor: Pipeline Scalability

**Goal:** Overhaul the core data pipeline connecting the Webhook, the AI Orchestrator, and the Database to guarantee high performance, lower latency, and transactional integrity under load.

---

## Task 1: FastAPI Python Backend (Eliminate CLI Overhead)

**Files:**
- Modify: `packages/agents/pyproject.toml`
- Create: `packages/agents/src/arete_agents/server.py`

**Implementation:**
1. Add `fastapi` and `uvicorn` to the Python project: `uv add fastapi uvicorn`.
2. Create a FastAPI server (`server.py`) exposing two REST endpoints:
   - `POST /review`: Accepts JSON matching `PRContext`. Calls `ReviewOrchestrator(llm).run(pr)` and returns the `ReviewResult` JSON.
   - `POST /chat`: Accepts JSON with chat context. Calls `ChatAgent(llm).reply(context)` and returns the string response.
3. This eliminates the 2-3 second cold-boot penalty of `subprocess.run` on every single GitHub webhook event.

## Task 2: Refactor Node.js Webhook Bridge (HTTP > Subprocess)

**Files:**
- Modify: `packages/webhook/src/review-bridge.ts`
- Modify: `packages/webhook/src/chat-handler.ts`

**Implementation:**
1. In `review-bridge.ts`, replace the `spawn` logic with a native `fetch('http://127.0.0.1:8000/review', { ... })` call.
2. Ensure timeouts are preserved via `AbortController` (e.g., 120s timeout).
3. In `chat-handler.ts`, replace the `spawn` logic with a `fetch('http://127.0.0.1:8000/chat', { ... })` call.

## Task 3: Prisma Transactional Integrity (Data Slop)

**Files:**
- Modify: `packages/webhook/src/webhook-handler.ts`

**Implementation:**
1. Wrap the current sequence of Prisma calls (`installation.upsert`, `repository.upsert`, `review.create`, `reviewComment.createMany`) inside a single `prisma.$transaction([])`.
2. This ensures that if the server crashes or the DB connection drops midway, we do not end up with an orphaned `Review` without its `ReviewComment`s. All data ingestion is guaranteed atomic.

---

Executing this plan transitions the Areté MVP from a fragile "scripted" architecture to a robust, scalable microservice architecture.
