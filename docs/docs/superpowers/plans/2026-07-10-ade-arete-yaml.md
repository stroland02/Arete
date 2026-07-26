# Areté — ADE Feature 1: The `.arete.yml` Config Engine

**Goal:** Transform Areté from a rigid, hardcoded tool into a customizable Agent Development Environment (ADE) by allowing users to dictate Standard Operating Procedures (SOPs) via a `.arete.yml` file in their repository root.

---

## Task 1: Node.js PR Fetcher Updates

**Files:**
- Modify: `packages/webhook/src/types.ts`
- Modify: `packages/webhook/src/pr-fetcher.ts`
- Add Dependency: `pnpm add yaml`

**Implementation:**
1. In `types.ts`, add a `customRules?: string[]` array to the `PRContext` interface.
2. In `pr-fetcher.ts`, add logic to attempt to fetch `.arete.yml` or `.arete.yaml` from the root of the repository using Octokit (`octokit.repos.getContent`).
3. If found, parse it using the `yaml` package.
4. Extract the `custom_rules` array (if present) and map it to `PRContext.customRules`. If the file doesn't exist, safely catch the 404 and default to an empty array.

## Task 2: Python Orchestrator & Agents Updates

**Files:**
- Modify: `packages/agents/src/arete_agents/models/pr.py`
- Modify: `packages/agents/src/arete_agents/orchestrator.py`
- Modify: `packages/agents/src/arete_agents/agents/base.py`

**Implementation:**
1. In `pr.py`, update `PRContext` Pydantic model to include `custom_rules: list[str] = []`.
2. In `orchestrator.py`, update the `SynthesizerAgent` prompt injection to include the `custom_rules`. For example: 
   *"The user has provided the following custom team rules. You MUST enforce these rules and remove any agent comments that contradict them: {custom_rules}"*
3. In `base.py`, ensure the base `system_prompt` for all 6 specialist agents also receives the `custom_rules` so they can avoid flagging things the user explicitly allowed (e.g., "Do not flag console.log").

## Task 3: Testing & Commit

**Implementation:**
1. Update tests in both `packages/webhook` and `packages/agents` to ensure the new field is passed cleanly.
2. Commit message: `feat: implement .arete.yml dynamic SOP configuration parser`
