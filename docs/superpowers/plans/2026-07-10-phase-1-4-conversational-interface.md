# Areté — Phase 1.4: Conversational Interface & Backend Data Flow

**Goal:** Fulfill the remaining functional backend requirements of Phase 1 to ensure Areté can solve PRs interactively and connect its data pipeline properly, ignoring UI work for now.

## Core Functional Gaps Addressed

1. **Conversational Interface (The "Solve" Loop):** Right now, agents drop a review and walk away. If a developer asks "Why?" or "How about this approach instead?", Areté ignores them. We need to handle `pull_request_review_comment` webhooks, pass the thread context back to a new `ChatAgent` in Python, and post an AI reply to the thread.
2. **Data Pipeline (Prisma DB Link):** The orchestrator generates brilliant data (`ReviewResult`), but we just post it to GitHub and throw it away. We must hook the `webhook-handler` up to the Prisma client so every PR review is persistently logged in our database, laying the backend foundation for the dashboard and Phase 2 analytics.

---

## Task 1: Python `ChatAgent`

**Files:**
- Create: `packages/agents/src/arete_agents/agents/chat.py`
- Modify: `packages/agents/src/arete_agents/cli.py`

**Implementation:**
- Build a generic conversational agent that receives: (1) The PR context, (2) The specific line/hunk of code being discussed, (3) The AI's original comment, and (4) The user's reply.
- It returns a conversational markdown response (not structured JSON).
- Update the CLI `__main__` to accept a `--mode chat` flag. If it's a chat, it routes to `ChatAgent.reply()` instead of `ReviewOrchestrator.run()`.

## Task 2: Webhook `pull_request_review_comment` Handler

**Files:**
- Modify: `packages/webhook/src/server.ts`
- Create: `packages/webhook/src/chat-handler.ts`

**Implementation:**
- Listen to `app.webhooks.on('pull_request_review_comment.created')`.
- Ensure it ignores its own comments (if sender.login === arete-app).
- Fetch the discussion thread from GitHub API.
- Call the Python CLI with `--mode chat`.
- Post the result back as a reply to the GitHub review comment (`octokit.rest.pulls.createReplyForReviewComment`).

## Task 3: Backend Data Persistence (Prisma)

**Files:**
- Modify: `packages/webhook/src/webhook-handler.ts`
- Modify: `packages/webhook/package.json`

**Implementation:**
- Move `@prisma/client` dependency and Prisma schema to a shared `packages/db` workspace so both `dashboard` and `webhook` can access it safely.
- In the PR review handler, after `postReview()`, write the `ReviewResult` to the database:
  - Upsert `Installation` and `Repository`.
  - Create `Review` (riskLevel, total_comments, etc).
  - Create all `ReviewComment` records linked to the review.

---

This plan ensures we focus 100% on the core engine's capability to solve problems interactively and store its results, leaving UI development for later.
