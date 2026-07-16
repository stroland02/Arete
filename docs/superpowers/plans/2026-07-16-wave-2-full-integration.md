# Kuma — Wave-2 Full Integration Plan (2026-07-16)

**Goal:** take everything we've built (this session + prior waves) from "works in
pieces / seeded" to **one fully-wired, secure, agentic PR-healing service**. This
is the gap map + the dispatch to Engineers 1–3.

North star (unchanged): *Kuma — your AI Software Healing Engineer.* Self-healing
software as a living organism; the org that builds Kuma runs on Kuma's own anatomy.

---

## 1. Where we are — verified live this session

Committed on `feat/glass-box-cockpit` (6 commits this session), all typechecked/tested:

- **Code map builds on connect** (webhook→agents index) and **loads keyless via CLI mode**
  (agents boot with no LLM key; `codebase-memory-mcp` driven through `cli`, not the broken
  stdio session). Verified: real 11-node graph of `beancount-sandbox` renders on `/overview`.
- **Services triage inbox lists the connected repo's REAL PRs**; selecting one streams its
  real Synthesizer transcript via the existing SSE.
- **Onboarding card persists + evolves** ("Setup complete → Review findings").
- **Connections page shows Connected + repo.**
- **Sensorium graph id fix** (external id, not `Number(uuid)`=NaN) and **tokenless clone** of
  public repos.

Already live from prior waves: auth (Google + credentials), GitHub App install→tenant linking,
seeded reviews/findings on `/agents`, Glass Box cockpit, dashboards, connector catalog UI,
outbound webhooks (P1.1), Sensorium v1.

**Reality check:** the review data on `/agents` is **seeded**, not produced by a live review —
because the agents review pipeline needs an LLM key and end-to-end wiring. That's gap #1.

---

## 2. The gap map — what "fully functional" still needs

Grouped into workstreams. Each names the spec it builds on where one exists.

### A. Turn the core review loop ON (seeded → real)
The whole product hinges on a real PR producing a real review. Today that path exists
(`webhook → enqueue → worker → agents /review → post comments`) but has never run live here.
- **The model comes from workstream I (AI Models connect), NOT a raw `.env` key.** Live reviews
  are lit up by connecting a model in the Connections UI — the user's own Ollama (free, the
  default) or a BYO cloud key, per-tenant + encrypted. The `.env` Gemini key is dropped as a
  path; A now **depends on I** (see §I). Kuma-runs-on-Kuma: we dogfood our own feature.
- Drive one real PR on `beancount-sandbox` end-to-end through the connected model; confirm
  findings post to the PR and surface on `/agents` + `/overview` from live data, not the seed.
- Remove/guard the seed path so live and seeded data never mix in a tenant.

### B. The Fix workflow — the one-of-a-kind differentiator  *(spec: `2026-07-13-issue-container-and-pr-pipeline.md`, `2026-07-13-synthesizer-component-and-critic.md`)*
The "Fix → PM dispatch → specialists → approve → stage → send PR" loop. The `IssueContainer`
state machine, projection, and SSE all exist; what's missing is the **live driver** and the
**real fix generation + PR open**:
- **Fix generation (agents):** specialists propose an actual patch (diff) for a finding —
  the hard new capability. Must be grounded (no fabricated diffs; anti-fabrication rule holds).
- **Live driver:** advance a container `detecting → fanning_out → verifying → composing → ready`,
  streaming `SynthStep`s live (not just the terminal projection of a stored review).
- **Approval gate (UI):** the human approves `ready → solution_approved` on Services/Agents.
- **PR staging + send (webhook):** compose a real branch/patch and open the PR via the GitHub
  App; `solution_approved → posted`. **HITL moat preserved** — never auto-send. The
  `POST /staging/send` seam ships (Eng1, `a13a2b9`); its `loadApprovedContainer` is inert
  pending the store below.
- **Container persistence (foundational — Eng1 owns; deferred spec §6.1, now in scope):** no
  persisted approved-container exists yet (the dashboard's is a read-only review *projection*;
  the driver's is transient). Add a persistent **`IssueContainer` model to `@arete/db`**
  (`installationId`, `state`, `gates` incl. `solutionApprovedAt`, `target`, `findings`) alongside
  `ModelConnection` — Eng1 is sole schema writer. `loadApprovedContainer` becomes a scoped,
  gate-enforced Prisma read (`id AND installationId=<caller> AND gates.solutionApprovedAt NOT
  NULL`). **Write side is a contract others fulfill against the same table:** the dashboard/driver
  create the container (user clicks "Fix"), the driver advances state, Eng2's approval UI sets
  `solutionApprovedAt`. Land early — the whole Fix workflow sits on it.

### C. Orchestration integration — PM⇄specialist message-passing  *(Eng2 `feat/orchestration-study`, `packages/orchestration`)*
`packages/orchestration` exists only on Eng2's unmerged branch. Merge it, then wire it as the
**engine behind workstream B**: a PM agent analyzes a problem, dispatches to specialist
disciplines who message each other *through the PM* (visible in the agents chat), then hands to
the Synthesizer. This is "Kuma runs the work floor" — the product's agents use the same
star-topology model our human fleet does.

### D. Telemetry ingestion + "Connect this service"  *(specs: telemetry-connectors, generic-oauth-connector-infrastructure, sentry-vercel-stripe-connectors)*
- Per-provider **"Connect this service"** cards (the deferred UX item 4) on the Telemetry tab —
  detected/known providers not yet connected → CTA → `/connections/[id]`.
- Real ingestion so a review can cite "this endpoint failed 6× this week" (OAuth connect →
  snapshot at review time → `TelemetrySnapshotRecord` → dashboards/services evidence).

### E. Approval-exec (P1.3) — apply/resume  *(contract in the ledger)*
`tools/actions.py` still **stubbed/simulated**. Finish the consumer loop:
- **Eng3 (agents):** real `POST /approvals/apply` (LangGraph interrupt→checkpoint→resume,
  idempotent per `approvalId`).
- **Eng1 (webhook):** BullMQ `approval-exec` worker calls it; retry/terminal semantics per the
  ruling (200 applied→resolve; 200 failed→terminal; non-2xx→retry).

### F. Context-map completeness
- **Rewire the review-time context-map tools** (`get_context_map_tools`) off the broken stdio
  session onto `cli` mode too (same fix as the code map; still stdio today).
- **Index-on-connect for real installs:** mint a real installation token so private repos index
  (tokenless path only covers public); confirm the webhook→`/context-map/index` path on a real
  install event.
- **Persistence:** ensure the repos/index volume persists in prod (`docker-compose.prod.yml`).

### G. Security & integrity hardening — gating for PR #1
- **auth-CRITICAL:** `/api/webhooks/endpoints` cross-tenant secret exposure — gate behind the
  authenticated tenant-scoped API or remove the public route; adversarial cross-tenant test.
- **Migration history repair:** confirm `CREATE TABLE` migrations exist for `ApprovalPrompt` /
  `AgentMemory` so `migrate deploy` is clean from zero (local was unblocked with `db push`).
- **Tenancy audit:** every new query (`getServicesInbox`, `getConnectedRepositories`,
  sensorium external-id path) re-verified for `installationId` scoping.
- **Secret handling:** installation tokens never logged/persisted; `.env` keys (`GEMINI_API_KEY`,
  GitHub App PEM, `TELEMETRY_ENCRYPTION_KEY`) confirmed out of git and injected at runtime.

### H. Integration gate → PR #1
Merge the six committed fixes + Sensorium + P1.1 (+ orchestration once green) onto a fresh
`integration` branch; run the FULL matrix; drive the real flow; open ONE PR; **human merges.**

---

## 3. Dispatch — three engineers (star-topology; PM owns contracts)

Lanes are kept non-overlapping per the ownership matrix; dashboard is shared-additive and
declared. Each engineer returns the uniform status contract
`scope-confirmed → progress → blockers → done+verification`.

### Engineer 1 — webhook + db  *(owns `packages/webhook`, sole `@arete/db` schema writer)*
1. **Security gate (do first):** fix `/api/webhooks/endpoints` cross-tenant exposure +
   adversarial test (workstream G). Confirm `ApprovalPrompt`/`AgentMemory` CREATE-TABLE
   migrations so `migrate deploy` is clean.
2. **Approval-exec worker (P1.3):** BullMQ `approval-exec` consumer → calls Eng3's
   `/approvals/apply`; retry/terminal semantics per the ledger contract.
3. **PR staging + send (workstream B):** given an approved `IssueContainer`, compose a branch +
   patch and open the PR via the GitHub App; enforce the HITL gate (only off an approved
   container; never auto-send). Idempotent per container.

### Engineer 2 — orchestration + Fix-workflow UI  *(owns `packages/orchestration`; dashboard shared-additive)*
1. **Merge/integrate `packages/orchestration`** onto the integration line (Phase A).
2. **Live Fix-workflow driver (workstream B/C):** the PM⇄specialist dispatch engine that
   advances an `IssueContainer` and emits live `SynthStep`s; surface it in the agents chat
   (PM mindset visible) and the Services center Synthesizer via SSE.
3. **Approval-gate UI:** the human `ready → solution_approved` control on Services/Agents; then
   the staged-PR view and **Send PR** action (calls Eng1's staging endpoint).
4. **Telemetry "Connect this service" cards** (workstream D UX / item 4).

### Engineer 3 — agents (Python)  *(owns `packages/agents`)*
1. **Approval-exec apply/resume (P1.3):** replace `tools/actions.py` / resolver stubs with real
   apply + LangGraph resume; expose idempotent `POST /approvals/apply`.
2. **Fix generation (workstream B):** specialists propose a real, grounded patch (diff) per
   finding — the core new capability behind the Fix workflow. No fabricated diffs.
3. **Context-map: rewire review-time tools to `cli` mode** (workstream F) + real-install
   index-on-connect (token path).
4. **Turn real reviews on (workstream A):** with a provisioned key, drive one live review on
   `beancount-sandbox` end-to-end; confirm live (not seeded) findings.

---

## 4. Sequencing & integration gates

1. **Now:** Eng1 security gate, and **workstream I (AI Models connect) as the critical path** —
   Eng1 `ModelConnection` + review-job resolve, Eng3 per-request model in `/review`, Eng2 the
   AI Models Connections UI. This is what turns real reviews on (A depends on I), so it leads.
2. **Then:** real-reviews-on (A) driven through a connected model (Ollama free, or BYO key);
   P1.3 pair (Eng1 worker ⇄ Eng3 apply/resume) integrated together.
3. **Then:** the Fix workflow (B) as a coordinated trio — Eng3 fix-gen → Eng2 driver+UI+approval →
   Eng1 stage+send — behind the HITL gate.
4. **Parallel throughout:** Eng2 telemetry cards (D); Eng3 context-map completeness (F).
5. **Gate → PR #1 (H):** PM builds `integration`, full matrix + real-flow drive, one PR, human merges.

**Invariants for every task:** maintain tenancy scoping (`installationId`), the HITL approval
moat (no auto-send/auto-merge), the anti-fabrication rule (no invented findings/diffs), and keep
secrets out of git and logs.
