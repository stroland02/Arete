# Areté — Phase 1.3: Remaining Agents & Customer Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the 6-agent review pipeline (add TestCoverage, DeploymentSafety, BusinessLogic agents), update the orchestrator and comment poster to support all 6, and scaffold a Next.js customer dashboard with review history.

**Prior art:**
- Phase 1.1: Monorepo foundation + 3-agent pipeline (Security, Performance, Quality) ✅
- Phase 1.2: GitHub App + TypeScript webhook handler + CLI bridge ✅

**What remains from the original Phase 1 roadmap (proposal §12):**
- [ ] 6-agent review pipeline — need 3 more agents
- [ ] Conversational interface — reply to agent comments in PR thread
- [ ] Stripe billing integration
- [ ] Basic customer dashboard (review history, usage stats)
- [ ] GitLab webhook support (deferred to Phase 1.4)

**Architecture:** Same patterns as Phase 1.1 — each agent extends `BaseReviewAgent`, provides `agent_name` and `system_prompt`, inherits all JSON parsing/retry/truncation logic from the base class. Orchestrator updated to include all 6 agents. Dashboard is a new `packages/dashboard` Next.js app.

**Tech Stack additions:** Next.js 15, Prisma (PostgreSQL ORM), next-auth (GitHub OAuth)

## Global Constraints (carried from Phase 1.1)

- Python managed exclusively by `uv` — never `pip install` directly
- Node.js package manager: `pnpm` — never `npm install` inside packages
- All secrets in `.env` only — `.env` is in `.gitignore`, never committed
- TDD strictly enforced: write the failing test before writing the implementation
- Git commits use conventional format: `feat:`, `fix:`, `test:`, `chore:`, `docs:`
- Brand/product name: Areté. Code identifiers use `arete` (no accent in code)
- All agent prompts instruct the LLM to return **only valid JSON** — never freeform text
- Every PR file review is isolated: agents receive one file at a time, results merged by orchestrator

---

## Task 1: TestCoverageAgent

**Files:**
- Create: `packages/agents/src/arete_agents/agents/test_coverage.py`
- Modify: `packages/agents/tests/test_agents.py` (append test)

**Interfaces:**
- Consumes: `BaseReviewAgent` from Phase 1.1
- Produces: `TestCoverageAgent(llm) -> BaseReviewAgent` with `agent_name == "test_coverage"`

---

## Task 2: DeploymentSafetyAgent

**Files:**
- Create: `packages/agents/src/arete_agents/agents/deployment_safety.py`
- Modify: `packages/agents/tests/test_agents.py` (append test)

**Interfaces:**
- Consumes: `BaseReviewAgent` from Phase 1.1
- Produces: `DeploymentSafetyAgent(llm) -> BaseReviewAgent` with `agent_name == "deployment_safety"`

---

## Task 3: BusinessLogicAgent

**Files:**
- Create: `packages/agents/src/arete_agents/agents/business_logic.py`
- Modify: `packages/agents/tests/test_agents.py` (append test)

**Interfaces:**
- Consumes: `BaseReviewAgent` from Phase 1.1
- Produces: `BusinessLogicAgent(llm) -> BaseReviewAgent` with `agent_name == "business_logic"`

---

## Task 4: Update Orchestrator for 6 Agents

**Files:**
- Modify: `packages/agents/src/arete_agents/orchestrator.py`
- Modify: `packages/agents/tests/conftest.py`
- Modify: `packages/agents/tests/test_orchestrator.py`

**Interfaces:**
- Orchestrator now imports and uses all 6 agents
- conftest cyclic_llm cycles through 6 agent responses instead of 3
- New test verifies all 6 categories appear in merged results

---

## Task 5: Update Comment Poster for New Categories

**Files:**
- Modify: `packages/webhook/src/comment-poster.ts`
- Modify: `packages/webhook/src/types.ts`

**Interfaces:**
- Updated summary includes all 6 agent categories
- Badges render correctly for new categories

---

## Task 6: Scaffold Next.js Dashboard

**Files:**
- Create: `packages/dashboard/` (Next.js 15 app)
- Modify: `pnpm-workspace.yaml` (no change needed — already `packages/*`)
- Modify: `package.json` (add `dev:dashboard` script)

---

## Task 7: Database Schema (Prisma)

**Files:**
- Create: `packages/dashboard/prisma/schema.prisma`
- Tables: `Installation`, `Repository`, `Review`, `ReviewComment`

---

## Task 8: Dashboard Pages

**Files:**
- Dashboard landing page with installation list
- Review history page with filtering
- Review detail page showing all agent comments

---
