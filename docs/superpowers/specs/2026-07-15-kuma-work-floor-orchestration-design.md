# Kuma-Runs-the-Work-Floor — Orchestration Phase 2 Design

**Status:** Design-only. Presented for PM approval before any build.
**Author:** Engineer 2 (orchestration lane).
**Date:** 2026-07-15.
**Builds on:** `packages/orchestration` v1 (this author) + the existing dashboard
issue-pipeline / SSE transcript (`packages/dashboard`, read-only here).
**Prior art in-repo:** `docs/superpowers/specs/2026-07-15-orchestration-substrate-design.md`
(the substrate), `docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md`
(the Synthesizer console + SSE contract this reuses).

> **Guardrails honored by this document.** Design only — no code this round. No
> edits to `packages/agents`, `packages/dashboard`, or `server.py`. Everything
> below is additive and reuses two things that already exist: my star-topology
> substrate (`packages/orchestration`) and the dashboard's live event stream
> (the Glass Box / Synthesizer SSE pattern). The cross-language Python wiring is
> a **documented, deferred seam** — not built here. YAGNI throughout.

---

## 0. The one-sentence vision

A problem/error enters → a **PM-agent (frontier work distributor)** analyzes it
and **dispatches** across a roster of specialist agents (reproduction, root-cause,
fix-author, test-author, security, reviewer, **QA/UI-validation**) → the specialists
**message each other through the PM** (star topology) and those messages are
**visible on the agents-chat page** → a **QA agent validates the fix actually works**
and, on failure, routes the exact error back through the PM for another pass → once
green, the work is pushed to the **Synthesizer** for the final overview → the **PR**,
which a **human** approves.

This is the PM⇄specialist work floor we dogfood by hand, automated inside Kuma —
and it is **symmetric** with the fleet: a human QA Engineer tests our dogfooded
localhost; a QA *agent* tests customers' fixes. Same pattern, both directions.

---

## 1. Deliverable 1 — Understand the current flow (grounded in the code)

I read `packages/agents` read-only. Here is the *actual* flow today, not an
assumption.

### 1.1 Entry point and pipeline

- **Entry:** `packages/agents/src/arete_agents/server.py` → `POST /review` takes a
  `PRContext` and calls `_orchestrator.run(pr)`. (Also `POST /chat` → `ChatAgent`,
  and a context-map UI URL endpoint.)
- **Orchestrator:** `orchestrator.py` compiles a LangGraph `StateGraph`. Its
  `route()` at `START` performs a **static cartesian fan-out** — one
  `Send("execute_agent_review", …)` per *(file × agent)* pair (special-cased to a
  single `CIAgent` when `pr.ci_logs` is present). **There is no analysis/triage
  step; distribution is a hardcoded loop.**
- **Roster (fixed, review-only):** six agents hardcoded in
  `ReviewOrchestrator.__init__` — Security, Performance, Quality, TestCoverage,
  DeploymentSafety, BusinessLogic (+ conditional CIAgent). Every one subclasses
  `BaseReviewAgent.review_file()` (`agents/base.py`) and returns `FileReview`
  **comments**. They author *findings* with a bounded tool-loop (`MAX_TOOL_ROUNDS`,
  context-map + MCP + native-action tools). **None reproduces, root-causes, or
  writes a fix.**
- **No inter-agent communication.** Pure map-reduce: each agent reviews its file in
  isolation and in parallel; results merge via `operator.add` reducers
  (`raw_reviews`, `noise_decisions`, success/failure tallies). No coordinator
  mid-flight, no messages between agents.
- **Synthesizer = the reduce + verify/drop stage** (`SynthesizerAgent.synthesize`):
  dedup, verify each comment against the real diff, **drop hallucinated/unverified
  comments** (`dropped_count`), then deterministic gates `_apply_critic`
  (opposite-tier keep/drop), `_apply_grounding` (line number + security evidence
  must exist in the diff), `_apply_noise_decisions`, and finally `decide_verdict`
  (deterministic risk-tiered verdict). Fallbacks everywhere (blind merge).
- **Output:** a `ReviewResult` (comments + verdict). **Not a fix, not a PR.**
- `auto_resolver.py` is a **simulated stub** (mocked DB + mocked GitHub API) — a
  background cron that re-checks whether a later dev push fixed a flagged issue and
  auto-resolves the thread. Not a fix-author; not part of `/review`.

### 1.2 What the dashboard already models (the reuse surface)

The dashboard's issue-pipeline already speaks the work-floor vocabulary — this is
what deliverable 3 reuses rather than reinvents:

- `IssueContainer` (`packages/dashboard/src/lib/issue-pipeline/types.ts`): a
  problem/error container with `source`, `severity`, `fingerprint` (dedupe),
  `findings`, a **`transcript: SynthStep[]`**, a `pr: PullRequest | null`, and
  **`gates` (`solutionApprovedAt/By`, `postedAt/By`)** — a human approval gate.
- `SynthStep.kind` is already `dispatch | report | verify | keep | drop | compose
  | posted` — the verbs of a dispatch→report→verify→compose→post work floor.
- The SSE contract already exists:
  `packages/dashboard/src/app/api/containers/[id]/stream/route.ts` emits
  `init` (snapshot) → `step*` (ordered transcript) → `done`, consumed by a **pure
  reducer** (`synth-stream-model.ts`) — unit-testable without a browser.
- `agent-conversation.tsx` is the per-specialist chat surface on `/agents`.

### 1.3 What changes vs. what's reused (PM-confirmed framing)

| | Today | Vision |
|---|---|---|
| **Distribution** | static (file × agent) cartesian fan-out | **PM-agent** analyzes, then **dynamically dispatches** |
| **Roster** | 6 review-only agents (comment authors) | broader disciplines incl. **reproduction, root-cause, fix-author, test-author, QA/UI-validation** |
| **Coordination** | none — isolated parallel map-reduce | **star-topology messages** (my substrate), **visible** on agents-chat |
| **Output** | `ReviewResult` (comments + verdict) | a validated **fix → PR** |
| **Reused as-is** | — | **Synthesizer verify/drop + final-overview**, LangGraph runtime, per-role LLM tiering, the tool-loop agent base + context-map grounding, the deterministic verdict gate, the **IssueContainer/SynthStep/SSE** surface, and the **human approval gate** (`gates.solutionApprovedBy` ≙ my `gate.ts` "no agent message is consent") |

---

## 2. Deliverable 2 — The PM-distributor model on `packages/orchestration`

### 2.1 Role mapping (no change to the `Role` enum)

The substrate's three roles already carry this cleanly:

- **PM-distributor → `orchestrator`** (`canDispatch`, `canGate`). Analyzes the
  incoming problem, produces a dispatch plan, routes inter-agent messages, decides
  when the work is ready for synthesis.
- **Specialists → `worker`** (`canReport`). They differ by **discipline**, not by
  role — so we add a `Specialty` tag to workers/tasks, additively, rather than
  expanding `Role`.
- **Synthesizer → `integrator`** (`canReport`, `canGate`). Runs verify/drop +
  composes the final overview/PR, then presents to the human gate. `merge()` still
  requires `approval.human === true`.

### 2.2 The specialist roster (disciplines within the `worker` role)

| Specialty | New or reused | Does | Emits (kind) |
|---|---|---|---|
| `reproduction` | **new** | confirms the error reproduces; produces a failing repro/trace | `report` (repro-confirmed / not-reproducible) |
| `root-cause` | **new** (uses today's context-map tools) | localizes the defect across the graph | `report` (root-cause + evidence) |
| `fix-author` | **new** (action agent) | writes the code fix | `report` (candidate patch) |
| `test-author` | **new** (action agent) | writes/updates tests that lock the fix | `report` (test patch) |
| `security` | **reuse** `SecurityAgent` | reviews the fix for security | `report` (findings) |
| `reviewer` | **reuse** the review agents (quality/perf/business-logic/deployment) | reviews the candidate fix | `report` (findings) |
| `qa` | **new (this addendum)** | **drives the affected workflow/UI and validates the fix end-to-end** | `qa-result` (pass / fail + exact error) |

The existing six review agents are **not thrown away** — they become the `security`
and `reviewer` disciplines dispatched *after* a fix exists, instead of *instead of*
a fix.

### 2.3 The PM-agent analyze → dispatch step

Replaces the static `route()` for the problem-resolution path (see §2.8 on
coexistence). Additive substrate types (my lane):

```ts
// packages/orchestration — additive, pure model
export type Specialty =
  | "reproduction" | "root-cause" | "fix-author"
  | "test-author" | "security" | "reviewer" | "qa";

export interface DispatchPlan {
  problemId: string;
  analysis: string;              // the PM-agent's initial read
  assignments: Assignment[];     // who does what, with deps
}
export interface Assignment {
  specialty: Specialty;
  taskId: string;
  dependsOn: string[];           // e.g. fix-author dependsOn root-cause
  lane: Lane;                    // reuses ledger.ts Lane + conflict detection
}
```

The PM-agent's output is a `DispatchPlan`; each `Assignment` becomes a `TaskEntry`
in the existing ledger, so **lane-conflict detection and `claimable()` already
apply** (two fix-authors on overlapping files is caught pre-execution — our
differentiator). Dispatch order is dependency-driven: reproduce → root-cause →
(fix-author ∥ test-author) → (security ∥ reviewer) → **qa** → synthesize.

### 2.4 Star-topology messages (already enforced)

Specialists never talk peer-to-peer. Every message is an `Envelope` routed through
`messages.route()`, which already rejects worker↔worker. A root-cause worker that
needs the reproduction trace asks the **PM**, who relays. New `MessageKind`s added
additively: `"qa-result"`, and a generic `"handoff"` for PM→worker task hand-offs.
This is exactly the MAST "inter-agent misalignment" surface the star topology
shrinks, and it is what becomes visible on the chat page (§3).

### 2.5 The QA feedback loop (the addendum, symmetric with the fleet)

After `fix-author` + `test-author` produce a candidate, the PM dispatches `qa`. The
QA agent drives the affected workflow/UI against a **validation harness** (see open
question Q2 — likely Eng3's Sandbox Customer test bed / Fable's Live Preview) and
returns a `qa-result` envelope to the PM:

```
                 ┌─────────────────────────────────────────┐
                 ▼                                           │  (fail: exact error,
  reproduce → root-cause → fix-author ∥ test-author          │   routed back through PM)
                          → security ∥ reviewer → QA ────────┤
                                                             │
                                                 pass ───────┴──▶ Synthesizer → PR → human gate
```

- **pass** → PM marks the fix `done` (status machine requires
  `verification.droveRealFlow === true` — QA *is* that real-flow evidence) and
  escalates to the Synthesizer.
- **fail** → PM re-dispatches `root-cause`/`fix-author` with the **exact error QA
  reported**, as a new pass. This maps onto the status machine as a `blockers`
  report that reopens `progress`.
- **Bounded** by a `maxPasses` guard (additive to the substrate; default proposal
  **3** — Q3). On exhaustion the PM escalates to the **human** gate with the QA
  transcript rather than looping forever — directly countering the MAST
  "no-termination / infinite-loop" failure mode.

`maxPasses` and the pass/fail transition are pure additions to the status/ledger
model — buildable in my lane with tests, no agents/dashboard dependency.

### 2.6 The driver seam → real LangGraph agents

The substrate stays pure; a **driver** carries dispatch/messages to a real backend.
`InMemoryDriver` is the reference (tests/local). Two deferred drivers implement the
same `OrchestrationDriver` interface (documented, **not built this round**):

- `dispatch(task)` → issue a LangGraph `Send` / `Command(goto=specialtyNode)` to
  spin the specialist node (replacing the static cartesian `route()`).
- `send(envelope)` → write to the graph's message channel / state.
- `drain()` → read envelopes emitted back toward the hub for surfacing (§3).

**Cross-language reality (flagged, Q1):** the substrate is TypeScript; the agents
are Python. `Envelope`/`TaskEntry`/`DispatchPlan` are plain JSON-serializable
contracts, so the seam has two viable shapes: **(a)** a TS coordinator that reaches
the Python agents service over HTTP (the service is already FastAPI), or **(b)** a
Python `LangGraphDriver` that mirrors the contract and the TS package is the
reference spec. This decision touches the **agents lane**, so it is a PM
coordination item, not something I decide unilaterally. Either way the substrate
does not change — only which side hosts the driver.

### 2.7 Where the Synthesizer fits (reused, scope widened)

The Synthesizer is the `integrator`. It keeps its verify/drop role verbatim, and
its scope widens from "merge review comments" to "assemble the validated fix into a
PR overview." Its output feeds the existing `IssueContainer.pr` + the human gate
(`gates.solutionApprovedBy`), which is my `gate.merge(batch, {human: true})` in the
dashboard's clothing. **No new gate is invented.**

### 2.8 Coexistence, not replacement (lower-risk, additive)

The current `/review` fast path (static fan-out, review-only) **stays**. The
PM-distributor is a **new path** for problem/error containers (the `IssueContainer`
ingest with `fingerprint` dedupe). A simple PR review does not need reproduction or
a fix-author; a production error does. Keeping both is additive and de-risks the
build. (Q4.)

### 2.9 Approaches considered for the load-bearing decision

**How does the PM-distributor + message bus relate to LangGraph?**

- **(A) Recommended — nodes-on-the-graph:** the PM-distributor and each specialty
  are LangGraph nodes; the driver translates `dispatch`/`send`/`drain` to
  `Send`/`Command`/state-reads. *Pros:* reuses LangGraph's runtime, retries,
  tracing (OTel spans already present), and the existing fallback machinery; the
  star contract is enforced at the driver boundary. *Cons:* couples the loop shape
  to LangGraph semantics.
- **(B) Beside the graph:** a standalone coordinator loop owns dispatch; LangGraph
  is only invoked to run a single agent turn. *Pros:* backend-agnostic. *Cons:*
  reimplements retries/tracing/fallbacks LangGraph already gives us; more surface,
  more MAST risk. Rejected for v1.
- **(C) Blackboard:** shared state, agents self-select work. *Pros:* flexible.
  *Cons:* violates the single-threaded-writes / star invariant we deliberately
  chose; hard to make auditable. Rejected.

Recommendation: **(A)**, because it maximizes reuse and keeps the star invariant at
one enforced boundary (the driver).

---

## 3. Deliverable 3 — Surfacing the conversation on the agents-chat page

**Reuse the Glass Box / Synthesizer SSE stream. Inter-agent messages are just more
event kinds on the stream we already have.**

### 3.1 The projection

`Envelope` (backend, from `packages/orchestration`, drained by the driver) →
normalized to a `SynthStep`-shaped event → emitted over the **existing**
`init → step* → done` SSE contract → rendered by the **existing** pure reducer +
transcript. The container's `transcript` becomes the conversation the user watches.

Mapping is nearly 1:1 with today's vocabulary:

| Envelope | `SynthStep.kind` |
|---|---|
| PM→worker `handoff` / `dispatch` | `dispatch` (exists) |
| worker→PM `status`/`report` | `report` (exists) |
| Synthesizer verify | `verify` / `keep` / `drop` (exist) |
| Synthesizer compose + PR posted | `compose` / `posted` (exist) |
| **QA `qa-result`** | **new kind `qa`** (pass/fail) |
| **repro / fix / test hand-offs** | **new kinds `repro` / `fix` / `test`** (optional; can ride `report` with a `specialty` field) |

So deliverable 3 is: (1) add a `specialty` field + a few `kind`s to `SynthStep`
(additive, backward-compatible — the reducer is append-only and already tolerant),
and (2) feed the stream from the **live orchestration run** instead of only from a
stored-review projection. **No second stream, no new transport.**

### 3.2 Coordinate with Glass Box (Fable)

Fable's Glass Box cockpit (`feat/glass-box-cockpit`) is building the live SSE
narration. Inter-agent messages are **another live event stream of the same shape**
— they must ride Fable's stream, not a parallel one. Concretely: agree one event
envelope (the `SynthStep` superset above) and one SSE endpoint contract with Fable
before either side builds surfacing. This is a **coordination point, design-only
here** — I do not touch the dashboard.

---

## 4. Deliverable 4 — Phased plan with lanes + cross-lane sequencing

| Phase | Lane(s) | Scope | Depends on |
|---|---|---|---|
| **A — substrate extensions (v1)** | **orchestration (me, exclusive)** | `Specialty`, `DispatchPlan`/`Assignment`, `qa-result` + `handoff` message kinds, the QA pass/fail transition + `maxPasses` guard, and a pure `Envelope → transcript-event` projection type. All pure model + tests. **No agents/dashboard edits.** | nothing — buildable now |
| **B — real agents + driver (later)** | **agents lane** (Eng3 / owner of `packages/agents`) + orchestration contract | PM-distributor node + new specialist agents (repro, root-cause, fix-author, test-author, QA); driver impl; keep review agents + Synthesizer; add the problem-resolution path beside `/review` | A's contract frozen; **QA agent needs a validation harness** (Eng3 Sandbox / Fable Live Preview) — Q2 |
| **C — chat surfacing (later)** | **dashboard lane** + coordinate with Glass Box (Fable) | extend `SynthStep` vocabulary; feed transcript from the live run; one shared SSE contract with Fable | B emits real envelopes; Fable stream contract agreed |

**Cross-lane sequencing for you to coordinate:**

1. **Phase A is mine and unblocked** — I can build it now (additive, tested, zero
   cross-lane risk) the moment you approve.
2. **Phase B needs the agents lane** and cannot start until A's contract is frozen.
   Its QA agent has a **hard dependency on a validation harness** — please sequence
   it against Eng3's Sandbox Customer test bed / Fable's Live Preview.
3. **Phase C needs the dashboard lane and a shared event contract with Fable** —
   sequence it after B and after the Glass Box stream shape is agreed, so we ship
   **one** stream.

**v1 vs later:** v1 = **Phase A only** (substrate model that expresses the whole
work floor + QA loop, fully tested in my lane). Phases B and C are real cross-lane
builds you schedule across engineers; this doc gives you their shape and
dependencies so you can order them.

---

## 5. Open questions (for PM)

- **Q1 — cross-language driver:** TS coordinator over HTTP to the Python agents
  service, or a Python `LangGraphDriver` mirroring the contract? (Touches agents
  lane; substrate unchanged either way.)
- **Q2 — QA harness:** what does the QA agent drive to validate a fix — Eng3's
  Sandbox Customer test bed, Fable's Live Preview, or a headless runner? This gates
  Phase B's QA agent.
- **Q3 — loop bound:** `maxPasses` before QA-fail escalates to the human gate.
  Proposed default **3**.
- **Q4 — coexistence:** confirm the PM-distributor is a **new path** for
  problem/error containers and the existing `/review` fast path stays for simple PR
  reviews (my recommendation), vs. replacing `/review` outright.
- **Q5 — trigger:** confirm the problem-resolution path is triggered by the existing
  `IssueContainer` ingest (`NormalizedEvent`, `fingerprint` dedupe), i.e. we reuse
  the ingest rather than add a new entry point.

---

## 6. Deferred seams (explicitly NOT built)

- The real Python/LangGraph driver and the new specialist agents (Phase B) — agents
  lane, not mine, and gated on Q1/Q2.
- The dashboard surfacing (Phase C) — dashboard lane + Fable coordination.
- Any edit to `packages/agents`, `packages/dashboard`, `server.py` — untouched this
  round.

## 7. Test plan (Phase A, when approved to build)

Mirrors the substrate's existing style (node:test + `tsx --test`, pure functions):
`DispatchPlan`→`TaskEntry` mapping feeds lane-conflict detection; the QA pass/fail
transition drives the status machine (`done` requires the QA real-flow evidence;
fail reopens `progress`); `maxPasses` exhaustion routes to the human gate, never
loops; the `Envelope → transcript-event` projection is 1:1 and total over all
`MessageKind`s. No network, no IO — same posture as `packages/orchestration` v1.
