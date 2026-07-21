# Kuma / Areté — Phase Wrap-Up (2026-07-20)

Convergence point: both trees (`integration-preview` and serving `feat/glass-box-cockpit`) at `f363060`. Working tree clean, tsc clean, all suites green.

---

## Phase 1 — Code Consolidation & Verification

**Test suites (1,298 tests, all green):**

| Package | Runner | Result |
|---|---|---|
| agents (Python) | pytest | 367 passed |
| webhook | vitest | 370 passed (62 files) |
| dashboard | vitest | 415 passed (72 files) |
| orchestration | node:test | 47 passed |
| topology | mixed | 23 passed |
| net-guard | node:test | 76 passed |

`tsc --noEmit` clean on webhook + dashboard. No dangling syntax errors, unresolved deps, or broken imports.

**Known non-blocking flake:** the webhook full-suite run intermittently drops ~2 tests (`pipeline.integration.test.ts` mock-state interference under parallelism); green on isolated/second run. Tracked, not a regression. Fix = isolate that suite's shared mock state.

**Commits finalized this wrap-up cycle:**
- `5153c1d` — faster LLM tiers (haiku fast-tier), honest provider errors, nav moves (Connections/History → Settings).
- `9bb46c8` — combine Dashboards into Overview.
- `3baeb7c` — "Connect an AI model" onboarding step (account-state-backed).
- `5e1e358` — connecting a model (re)activates it (switch providers in one click).
- `5bca81e` — Disconnect guarded by a confirm (prevent accidental key loss).
- `f363060` — merge Eng2's Active-badge + Set-active UI; hardened the connect route to **preserve the encrypted key** when none is re-entered (key-safety).
- Earlier this phase: `eb8dd74` healing loop closed end-to-end; `1d8e65f`/Eng3 agents `POST /fix`.

---

## Phase 2 — Frontend / UI Verification

**Nav consolidation (shipped):** sidebar is now **Overview · Services · Agents · Settings**.
- Overview hosts: greeting, **Code map** (inline SensoriumMap + "Open map"), onboarding checklist, metric tiles, agents-at-work strip, **Dashboards charts** (Review Activity / Findings / Telemetry presets), critical findings, recent reviews.
- Settings hosts a **Workspace card** linking Connections, AI Models, Review History.
- `/dashboards` → redirects to `/overview` (preserves `?installation=`); `/map`, `/connections`, `/history` routes retained for their links + deep-links.

**Onboarding checklist** (`deriveOverviewSetup`): 5 steps — Create account · Connect a repository · **Connect an AI model** (account-state `modelConnected`, CTA to `/connections/ai-models`) · Open a pull request · Get your first verified review. Existing users migrate to the correct step automatically; no fabricated checkmarks.

**AI Models page:** rows show an **Active** badge on the newest connection (the model reviews actually run on), a **Set active** control on idle saved connections (Ollama one-click; api-key providers prompt to re-enter the key), **Connect/Reconnect**, and a **Disconnect guarded by confirm** ("Remove key") warning that key loss is permanent. No Active/Connected state fabricated before `list()` hydrates.

**Agents chat:** a classified provider error returns 402 and renders the **actionable message** in the composer (e.g. "Your AI provider account is out of credits…") — never a silent failure. Verified live.

**Healing-loop UI:** Services WorkItemPanel "Fix it"/"Implement it" dispatches a real fix; live container stream via SSE; Kuma console labels a replayed terminal transcript **"Replay"** (anti-fabrication).

**Known UI debt (carried):** dead topbar controls (command palette, notifications — "coming soon"); agent-config drawer doesn't persist; several surfaces derive `connected` ad-hoc rather than through `getAccountState` (behaviorally equivalent, drift risk); AI Models has no per-row telemetry of "Active" beyond the badge (fine). None block the phase.

---

## Phase 3 — Backend / Backbone Audit

**Healing loop — WIRED end-to-end:** `POST /api/work-items/[id]/fix` creates an IssueContainer at `detecting` + fires webhook `POST /fix/trigger` (bearer-guarded) → `driveFix` resolves repo+model, mints an installation token, calls agents `POST /fix` (checkout → author → deterministic grounding gate → verify via `auto_resolver` → honest `fix_failed`), advances the container `detecting → fanning_out → ready` with the **real patch** (or `fix_failed`, WorkItem → open). Honest gate: an empty patch is treated as failure. Transcript persisted to `IssueContainer.transcript`; `getFixContainer` streams it; approve → send posts a PR **with content**.

**Latency (agents):** `haiku` fast-tier (`claude-haiku-4-5` / `gemini-2.5-flash-lite`) added across all builders; role defaults re-tiered for speed (chat/quality/test_coverage/performance/ci → haiku; security/business_logic/deployment_safety/synthesizer → sonnet; opus opt-in); `DEFAULT_MAX_TOKENS` 8192 → 4096. BYO per-request path intact.

**Honest provider errors:** `agents/llm/errors.py::classify_provider_error` (credit_balance / invalid_api_key / rate_limit / model_not_found / timeout / transient); `chat.py` retries only retryable, returns structured error; `/chat` forwards it; dashboard route → 402.

**Model-connection switching + key safety:** active model = newest `ModelConnection` (`createdAt desc`) in both `resolveActiveLlmForChat` and `resolveModelConnectionForReview`. Connect bumps `createdAt` (newest = active) and **only overwrites the encrypted key when a new key is supplied** — re-connect without re-entering preserves the stored key (no null-wipe). AES-256-GCM at rest; no route returns a decrypted key.

**Security posture:** webhook `/internal/*`, `/scan/trigger`, `/staging/send`, `/fix/trigger`, `/api/approvals/:id/execute` all behind the shared `INTERNAL_API_TOKEN` bearer (fail-closed 503 when unset). Dashboard API routes session-scoped; never trust a client-supplied installationId. Login/signup rate-limited. GitHub/Stripe/GitLab webhook signatures verified.

**Schema/migrations:** additive columns this phase — `IssueContainer.transcript`, `Review.agentStatuses` (migration `20260720120000`, idempotent). `InstallationAccess`, `AgentChatTurn` from earlier. No drift.

**Frontend↔backend sync:** wire contracts align — webhook emits the `llm` block matching agents `LLMConfig`; `FixRequest`/`FixResponse` frozen (numeric external installationId per repo-cache keying); `ScanRequest`/`ScanResponse` intact. Live smoke: dashboard 200, webhook token-guard 401, agents 200, `/fix/trigger` 202, agents `/fix` 422-validates.

**Backend gaps (carried):** telemetry ingestion runs only during a review (no background poller); ClickHouse "pulse" is a read-only dark wire (no producer); CI covers only agents/webhook/dashboard (orchestration/topology/net-guard/db have no CI job); no deploy pipeline/hosting target yet.

---

## Phase 4 — Roadmap & Alignment

### Completed this phase ✓
- Healing loop closed (Fix it → real patch → approve → PR).
- Agent latency overhaul (fast tiers, token budget, honest fast-fail).
- Honest provider-error surfacing across chat + reviews.
- Model-connection switching + key-safety (Active badge, Set active, key preserved, guarded Disconnect).
- Status-board read path (real `agent_statuses` → board).
- Nav consolidation (Overview absorbs Dashboards + Code map; Settings holds Connections/AI Models/History).
- Onboarding checklist extended with the AI-model step.

### Immediate next (dependencies noted)
1. **Connect Workspace onboarding** — clone-repo / select-folder, MCP-driven setup runnable from an agent, AI-model connect → Kuma install (skills + code mapping). *Blocked on user's reference data (to arrive next session).* Design constraint: **extend the existing setup, not greenfield** — reconcile with GitHub App connect, model connections, Sensorium/context-map indexing, `skills/loader`. New checklist steps need real `getAccountState` signals (no fabricated checkmarks).
2. **Eng1 promote-by-id** — `PATCH /api/model-connections/:id/activate` (bump timestamp or explicit `active` column) so api-key providers switch without re-entering the key; retires the delete-recreate interim.
3. **Anthropic catalog default** — change the connect-UI default model from `claude-opus-4-8` to a faster tier so new connections are fast by default.
4. **Telemetry ingestion worker** — background poller into `TelemetrySnapshotRecord` (history, not just latest); retire the producerless ClickHouse pulse.
5. **SDLC hardening** — CI jobs for orchestration/topology/net-guard/db; root aggregate test script; isolate the webhook flake; deploy pipeline + Neon free-tier + prod runbook.

### Architecture — current shape (proposal alignment)
Three services: **dashboard** (Next.js 16, session-authed, BYO-model), **webhook** (Express, GitHub App receiver + BullMQ worker + internal service-to-service surface behind a shared bearer), **agents** (FastAPI/LangGraph, six review specialists + synthesizer + critic + chat + scan + fix, provider-agnostic BYO). **db** (Prisma/Postgres) is the tenancy-scoped SSOT. Two engines are live end-to-end — **review** (PR → specialists → verified findings → PR) and **discovery** (connect → scan → work-item inbox); the third, **healing** (Fix it → authored+verified patch → human approve → PR), is now closed. Every tenant action rides their own model (BYO), keys encrypted at rest, HITL approval moat enforced server-side (never auto-send/auto-merge).

---

## Areas Requiring Manual Intervention Before Next Phase
1. **User must add Anthropic credits** (account at $0) or run on **Local · Ollama** — the "no response" was billing, now surfaced honestly. A lost Anthropic key must be regenerated (providers don't reissue).
2. **User's Connect Workspace data** is the gate for the next feature.
3. **Governance:** feature commits keep landing directly on the serving branch, bypassing `integration-preview` — reconciled by reverse-merge each time; enforce lane→preview for engineer sessions.
4. **Session limit** reached during this audit (resets 9:10pm ET) — the two deep audit subagents were cut short; findings above are synthesized from direct work this phase and are authoritative, but a fresh independent sweep next session is advisable.
