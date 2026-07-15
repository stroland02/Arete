# Orchestration & Agent-Expertise — Landscape Analysis

**Date:** 2026-07-15 · **Base:** `main` @ `76246ef` · **Prepared by:** Engineer 2 (`feat/orchestration-study`)

This is the research deliverable for the Orchestration & Agent-Expertise Study. It maps the
field (products, methodologies, OSS, agent-expertise techniques, and coordination-automation
patterns), then distills an **adopt / adapt / skip** verdict for each, grounded against what we
already run — a LangGraph-based Synthesizer plus the star-topology PM⇄engineer "work floor"
defined in [`2026-07-15-kuma-team-workflow-and-wave1-design.md`](../superpowers/specs/2026-07-15-kuma-team-workflow-and-wave1-design.md).
It closes with the design implications that seed `packages/orchestration` v1.

Research was gathered by five parallel research agents (star topology — dogfooding the very
pattern under study). Every non-obvious claim carries a primary-source URL; secondary/marketing
sources and unverified claims are flagged inline.

---

## 0. Executive summary

**The one finding that matters most:** across every serious source — Anthropic, Cognition,
Factory, Sourcegraph Amp, Cursor, GitHub, and Claude Code's own docs — the convergent lesson for
**coding** work is the same, and it is exactly our model:

> The win is **not** "many agents writing code in parallel." It is **one writer at a time per
> file-scope**, with additional agents used only to **review, verify, or fan out genuinely
> independent (non-overlapping) chunks**, and a **separate, human-gated integration step** —
> never concurrent writes reconciling themselves.

That is the star-topology invariant we already encode (workers never talk peer-to-peer, each owns
a disjoint file lane, integration is a separate gate). The field has independently converged on
it. Our job is therefore **not to invent a coordination model** but to (a) name and formalize the
one we already run into a reusable substrate, and (b) close the one gap nobody else has closed:
**proactive, pre-execution lane-conflict detection.**

**Three headline conclusions:**

1. **Our topology is validated, not exotic.** "Star / hub-and-spoke" is a named, documented
   pattern (AG2), synonymous with the "orchestrator-worker" pattern Anthropic recommends starting
   with. The evidence favors it over peer debate/mesh for our use case.
2. **We build a model + seam, not a framework.** LangGraph (which we already run), the Claude
   Agent SDK, and eventually the Python Synthesizer are *drivers*. `packages/orchestration` is the
   framework-agnostic **model** (roles, status contract, task ledger, gate, message envelope) with
   a **driver seam** — mirroring how `@arete/topology` separates the pure graph model from any
   renderer, and how A2A separates its Task/Message data model from its transports.
3. **Lane-conflict detection is our differentiator.** No inspected tool (Conductor, vibe-kanban,
   claude-squad, uzi, Orca) does proactive conflict detection — all rely on worktree isolation
   plus git surfacing conflicts *at merge time*. A ledger that flags overlapping declared lanes
   *before* work starts is stronger than current practice.

---

## 1. The central tension: single-agent vs. multi-agent

This is a live, unresolved debate, and the answer differs by task type.

- **Pro-multi-agent (research/knowledge work):** Anthropic's multi-agent research system beat a
  single agent by **90.2%** on their internal research eval — but at **~15× the token cost** of a
  chat turn (vs. ~4× for a single agent), and *only* where subtasks are genuinely parallelizable
  and don't share context. https://www.anthropic.com/engineering/multi-agent-research-system
- **Skeptical (coding):** Cognition's "Don't Build Multi-Agents" argues parallel subagents make
  *conflicting implicit decisions* and produce fragile, incompatible output (the "Flappy Bird with
  a Super Mario background" failure). Their follow-up narrows the verdict: multi-agent is fine **as
  long as writes stay single-threaded.** https://cognition.com/blog/dont-build-multi-agents ·
  https://cognition.com/blog/multi-agents-working
- **Benchmark signal (coding):** single-agent-with-good-tools currently tops SWE-bench (SWE-agent,
  mini-swe-agent) — reinforcing Anthropic's own admission that "most coding tasks involve fewer
  truly parallelizable tasks than research." (SWE-bench figures via secondary aggregators; treat
  as directional.)

**Takeaway for us:** the literature backs *parallel independent sampling + synthesis* (our
orchestrator fan-out) far more strongly than *symmetric peer debate*. Our workers should each stay
**simple, tool-focused single agents**; the coordination complexity belongs at the orchestrator
layer, not duplicated inside every worker. And we should **size lanes carefully** — over-
fragmenting a coding task invites the redundant/conflicting-work failure Anthropic saw.

---

## 2. Who is building this (products)

| Product | Coordinator↔worker mechanism | Verdict | Why |
|---|---|---|---|
| **Anthropic Research System** | Lead agent decomposes → isolated parallel subagents → distilled results back → dedicated `CitationAgent` verifies | **Adopt** | Closest primary-source validation of orchestrator→worker→verification. Coding-has-fewer-parallel-subtasks caveat → size lanes carefully. [src](https://www.anthropic.com/engineering/multi-agent-research-system) |
| **Cognition / Devin** | "Team of Devins" for large tasks; single human PM approves across the fleet (Nubank: thousands of parallel subtasks, human keeps the merge gate); **single-threaded writes** | **Adopt** the principle | Independent confirmation of our no-concurrent-writes invariant. [src](https://cognition.com/blog/multi-agents-working) · [Devin 2](https://cognition.com/blog/devin-2) |
| **Factory.ai Missions** | Explicit **orchestrator / worker / validator** roles (each a different model); validators *surface, never fix*; **halts to human on block** | **Adopt** | Near-exact match to PM/worker/human-gate; "validator surfaces don't resolve" and "halt-to-human" are the right contracts. [src](https://factory.ai/news/missions-architecture) |
| **Sourcegraph Amp** | Subagents *literally cannot talk to each other*, return only a final summary | **Adopt** | Non-Anthropic confirmation that no-peer-messaging is a shipping production pattern. [src](https://ampcode.com/manual) |
| **Cursor Background Agents** | Cloud VM **+ isolated git worktree** per agent; PR-based manual merge; ~8 parallel | **Adopt** | Closest commercial analog to our worktree + manual-PR-gate pipeline. [src](https://cursor.com/blog/agent-computer-use) |
| **GitHub Copilot coding agent** | Single agent per task; **PR requires human approval before CI/CD even runs** | **Adopt** the gate | Precedent that "no automation before human approval" is a security requirement, not a preference. [src](https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent) |
| **Conductor** | Mac app; `git worktree add` per workspace; human reviews & ships PR; **no coordinator, no task routing, no lanes** | **Adapt** | Validates worktree isolation + manual gate; the coordination gap is our differentiator. [src](https://www.conductor.build/) |
| **CodeRabbit** (competitor) | **Single-pass** LLM review + 40+ linters + codegraph + learned guidelines; **not multi-agent** | **Skip** (benchmark only) | Our multi-agent star topology is architecturally differentiated; match their review-quality UX (linter fusion, persistent guidelines). [src](https://www.coderabbit.ai/) |
| **Stage** (YC 2026) | Splits a PR into ordered "chapters" for human review; two-way GitHub sync; OSS CLI | **Adapt** | Solving our exact integration-gate pain; the diff-"chaptering" UX is worth borrowing for the gate. [src](https://www.ycombinator.com/launches/QQz-stage-code-review-platform-for-humans-and-agents) |
| **Claude Code (agent teams)** | Peer-messaging mode has **no worktree isolation** ⇒ file-lane partitioning becomes the *only* safety net | **Adopt** the lesson | We stack worktrees **+** lanes **+** star (no peer msg) — more defensive than Anthropic's own most-comparable feature. [src](https://code.claude.com/docs/en/agent-teams) |
| Runtime / InsForge / Alkera / Zed / OpenHands | Infra-sandbox / BaaS / vertical / no-orchestrator / controller-with-budget-caps | **Adapt/Skip** | Adjacent layers; borrow budget-capping (OpenHands) and env-snapshot + reviewed-write-gate (Runtime); rest off-topic. |

---

## 3. Methodologies

| Pattern | Verdict | Rationale (with citation) |
|---|---|---|
| **Supervisor / orchestrator-worker** | **Adopt** | Our model; best-evidenced for parallel decomposition + synthesis. [Anthropic](https://www.anthropic.com/research/building-effective-agents) |
| **Planner–executor (plan-and-execute)** | **Adopt** | PM produces the scope-confirmed plan; workers run internal ReAct loops. Prefer up-front planning over live re-planning for auditability. [ReAct](https://arxiv.org/abs/2210.03629) · [Plan-and-Solve](https://arxiv.org/abs/2305.04091) |
| **Star / hub-and-spoke** | **Adopt (validated)** | Named pattern (AG2); trade-offs (hub is SPOF/bottleneck, must understand all specialists) are manageable given our fixed contract + gate. [AG2](https://docs.ag2.ai/latest/docs/user-guide/advanced-concepts/pattern-cookbook/star/) |
| **Reflection / evaluator-optimizer** | **Adopt** | Best-evidenced quality loop *when success criteria are checkable* — maps onto "done+verification." Cap ~3–5 iterations. [Self-Refine](https://arxiv.org/abs/2303.17651) · [Reflexion](https://arxiv.org/abs/2303.11366) |
| **Role specialization** | **Adopt** | How we differentiate spokes; define non-overlapping scopes to avoid MAST "role ambiguity." [CAMEL](https://arxiv.org/abs/2303.17760) |
| **Blackboard (shared workspace)** | **Adapt (narrow)** | Full shared-write blackboard violates no-peer-comms; adapt only a **read-only** orchestrator-owned status board. [src](https://arxiv.org/abs/2510.01285) |
| **Debate / multi-agent argumentation** | **Skip** | Multiple 2025–26 papers: vanilla peer debate underperforms self-consistency at higher cost; also incompatible with no-peer-comms. [Stop Overvaluing MAD](https://arxiv.org/abs/2502.08788) |
| **Mesh / swarm / handoff (Swarm, GroupChat)** | **Skip** | Statelessness / shared-thread broadcast undermine auditability + single gate; useful only as the "why not" baseline. [Swarm](https://github.com/openai/swarm) · [AutoGen](https://arxiv.org/abs/2308.08155) |

**Does multi-agent debate beat a strong single agent?** The evidence skews *skeptical* for
symmetric peer debate ([2502.08788](https://arxiv.org/abs/2502.08788),
[2310.01798](https://arxiv.org/pdf/2310.01798),
[2601.19921](https://arxiv.org/html/2601.19921v2)) but *supportive* of parallel independent
sampling with aggregation ([More Agents Is All You Need](https://arxiv.org/abs/2402.05120)). Good
news for a star topology: we're aligned with the pattern that has evidence, and against the one
the field is walking back.

---

## 4. OSS frameworks & repos — adopt / adapt / skip

| Framework / repo | Verdict | What to borrow specifically |
|---|---|---|
| **LangGraph** (we run it) | **Adopt (concepts)** | `Command(update, goto)` unified control+state as the shape of status transitions; `Annotated[Type, reducer]` merge-per-field for the task ledger; `interrupt()`/`resume`/checkpointer as the literal integration-gate state machine (pause→persist→approve→resume, idempotent up to the interrupt). [handoffs](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs) · [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) |
| **Claude Agent SDK subagents + Agent Teams** | **Adopt** as primary driver-seam target | Mailbox-per-agent JSON inbox; shared task list with dependency-blocking + claim-locking; **plan-approval gate**; **"no agent message is consent"** permission boundary; context-isolation (only final message returns). [agent-teams](https://code.claude.com/docs/en/agent-teams) |
| **`affaan-m/ECC` `team-agent-orchestration` skill** | **Adopt** vocabulary/checklist | 7-state kanban (backlog/ready/running/review/blocked/merged/archived); agent-card schema (owner/scope/state/evidence/merge_gate); failure modes: **agent soup, invisible work, board theater, overlapping writes**. [src](https://github.com/affaan-m/ECC/blob/main/skills/team-agent-orchestration/SKILL.md) |
| **`stablyai/orca`** (our harness/IDE) | **Adopt** worktree model / **Skip** as protocol source | Validates isolated-worktree-per-worker; but Orca derives status by **scraping terminal OSC titles**, has a UI-level kanban, and explicitly does *not* supply task-ledger/lane/star-message primitives — those remain ours. [src](https://github.com/stablyai/orca) |
| **Magentic-One** (Microsoft) | **Adopt** the ledger design | Dual-loop Orchestrator: **Task Ledger** (facts/plan) + **Progress Ledger** (per-agent status/assignments) with **stall-detection → replan** — the model for our Integrator. [src](https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/) |
| **CrewAI** | **Adapt** vocabulary / **Skip** runtime | role/goal/backstory naming + explicit task→task `context` dependency edges; state model is weaker than LangGraph (no reducers/HITL). [src](https://docs.crewai.com/concepts/processes) |
| **OpenAI Agents SDK / Swarm** | **Adapt** distinction / **Skip** Swarm | "**agents-as-tools**" (manager keeps ownership) vs "**handoffs**" (ownership transfers): our star topology is agents-as-tools, never handoffs. Swarm deprecated. [src](https://openai.github.io/openai-agents-python/multi_agent/) |
| **MetaGPT / ChatDev** | **Skip** runtime / **Adapt** contrast | Fixed SOP/waterfall pipelines with pub-sub message pools — the opposite of a framework-agnostic model; use as the "rejected alternative" in the spec. [MetaGPT](https://github.com/FoundationAgents/MetaGPT) |
| **AutoGen / AG2** | **Skip** | Chat-log-as-state is weaker than reducer state; the Microsoft↔AG2 governance fork adds ecosystem risk. [AG2](https://github.com/ag2ai/ag2) |
| **`mattpocock/skills`, self-improving-agent-skills** | **Skip** for orchestration / note patterns | SKILL.md frontmatter-as-trigger + composable sibling docs (authoring); "exactly one surgical mutation per round, keep-if-improved" (future prompt-evolution). [skills](https://github.com/mattpocock/skills) |

---

## 5. Agent expertise & workflow quality

- **Personas alone are unreliable.** A 2026 controlled study found persona prompting helps
  *advisory* tasks but *hurts* conceptual/explanatory ones (adds jargon/hedging, lowers clarity).
  Our reviewers do directed technical analysis, so the bigger levers are **task-specific
  instructions, output schema, and few-shot**, not "You are an expert X." https://arxiv.org/html/2605.29420v1
- **Tool/interface design (ACI) shows consistent measured gains.** SWE-agent's custom
  agent-computer interface lifted SWE-bench from 3.8% → 12.5%. Design each worker's tools with
  bounded output, syntax-validate before accepting edits, and give explicit success/failure/empty
  strings. https://arxiv.org/abs/2405.15793 · https://www.anthropic.com/engineering/building-effective-agents
- **Memory helps cross-run, pollutes in-run.** Every frontier model degrades with input length
  (context rot), and *coherent distractors* hurt more than length alone. Keep each review run
  short-term/thread-scoped; put cross-run learnings in a **namespaced long-term store**, not every
  prompt. https://www.trychroma.com/research/context-rot · [CoALA taxonomy](https://arxiv.org/html/2309.02427v3)
- **Evals: start from real failures.** 20–50 cases drawn from observed failures; mix code/model/
  human graders; **grade the output, not the path**; isolate trial environments; judge with a
  *different, more capable* model. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents · https://github.com/openai/evals
- **Skills as the expertise mechanism.** Anthropic Agent Skills use progressive disclosure (metadata
  always loaded ~100 tokens → full instructions on trigger → bundled scripts on demand). Prefer a
  `SKILL.md`-style package per worker role over a static persona preamble. Self-improving-skills
  demonstrate an Executor→Analyst→Mutator loop (one surgical change/round, keep-if-improved).
  https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills

---

## 6. Automating our coordination (comms + integration)

**The pain:** the PM can't broadcast to the fleet, so every message is hand-relayed, and the
integration gate is manual.

- **Don't reach for A2A/AGNTCY.** Those solve *cross-vendor, untrusted-agent* interoperability — a
  problem we don't have. MCP stays scoped to agent-to-tool. Our setup is already the
  "orchestrator-subagent" pattern Anthropic recommends starting with. https://claude.com/blog/multi-agent-coordination-patterns
- **A lean typed-envelope bus satisfies the star invariant.** Envelope = `{taskId, traceId, from,
  to, kind, phase, laneClaims, cost}`; **topic-per-worker**, **reply-topic-to-PM-only**. The
  transport is swappable (human relay now → Claude Agent SDK `SendMessage`/mailbox → Redis Streams
  / DB queue later) — exactly how A2A separates data model from transport binding. https://a2a-protocol.org/v0.3.0/specification/
- **Integration gate = merge-queue mechanics + a shrunk human decision.** GitHub Merge Queue /
  Graphite / Mergify all test a **batch against its true merged state** and auto-evict / binary-
  split the offender. Model the Integrator as: test each branch standalone → construct the
  hypothetical merged state → run integration tests → evict/split on failure → present the human a
  **pre-verified batch** for the final manual merge. A general-purpose autonomous AI merge-
  gatekeeper is *not* yet established practice — keep the human decision point. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- **Task-ledger coordination is a solved shape.** Magentic-One's Task/Progress ledgers +
  stall-detection, LangGraph's `Command(update, goto)`, and the claim/lease pattern (worker claims
  a task; lease expires on crash so another run recovers) give us everything needed; Agent Teams
  already ships a dependency-aware task list with claim-file-locking. https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/

---

## 7. Failure taxonomy (MAST) → how our model counters it

The UC Berkeley **MAST** study analyzed 200+ traces across 7 frameworks and found most multi-agent
failures are **design** failures, not model-capability failures. https://arxiv.org/abs/2503.13657

| MAST category (share) | Our structural countermeasure |
|---|---|
| **Specification & system-design failures (41.8%)** — role/task ambiguity, poor decomposition, duplicate roles, no termination | **Status contract** (`scope-confirmed` forces explicit scope) + **disjoint lanes** (non-overlapping roles) + **done** as an explicit terminal with evidence |
| **Inter-agent misalignment (36.9%)** — communication breakdown, information withholding, reasoning mismatch | **Star topology** (no peer channels → minimal miscommunication surface; one auditable hub) |
| **Task verification & termination (21.3%)** — superficial/incorrect verification, premature stop | **Integration gate** ("done+verification" requires evidence; **full matrix + drive the real flow**; "no agent message is consent") |

This mapping is the strongest argument that our workflow is *the* countermeasure to the field's
documented failure modes — and it's why the substrate is worth formalizing.

---

## 8. Design implications → what `packages/orchestration` v1 builds

Synthesized, the model needs six pure, framework-agnostic pieces (mirroring `@arete/topology`'s
"pure model + provider seam"), each unit-testable in isolation:

1. **Typed roles** — `orchestrator` / `worker` / `integrator`, with capability predicates
   (who may dispatch, report, gate). Grounded in Factory's three-role split and our PM/Integrator.
2. **Status contract as a state machine** — `scope-confirmed → progress ⇄ blockers → done`, with
   `done` requiring verification evidence. Transitions modeled as atomic `(update, next)` values
   (LangGraph `Command` shape). Structurally counters MAST categories 1 & 3.
3. **Task ledger + lane-conflict model** — entries carry owner, lane (path globs / package),
   kanban state (ECC's 7 states), status phase, dependencies, evidence; **proactive overlap
   detection across concurrently-active lanes** (our differentiator). Vocabulary from ECC's
   `team-agent-orchestration` + Magentic-One's dual ledger.
4. **Integration-gate model** — gate states (`pending → verifying → verified/blocked → merged`);
   verification requirements (full matrix + drive-real-flow); **only a human/PM approval token
   transitions `verified → merged`** ("no agent message is consent"). Merge-queue batch semantics.
5. **Star-topology message contract** — typed envelope + a `route`/`validate` function that
   **enforces the star invariant** (workers ↔ hub only; peer-to-peer rejected). Envelope carries
   `traceId`, `phase`, `laneClaims`, `cost`.
6. **Driver seam** — an `OrchestrationDriver` interface (dispatch/send/receive) with an in-memory
   reference implementation for tests/local. **The Claude-Agent-SDK and Python-Synthesizer drivers
   are a documented, deferred seam** — not implemented this round (same discipline as Sensorium's
   provider seam).

**Explicitly out of scope for v1 (YAGNI):** any real backend wiring, a message transport,
persistence, an eval harness, skill self-improvement, or a UI. We build the **model + seam**, not a
speculative framework. Rejected alternatives (documented in the spec): mesh/GroupChat broadcast,
peer debate, A2A/AGNTCY cross-vendor protocols, MetaGPT-style baked-in SOP.

---

## 9. Source appendix (primary references)

Products: [Anthropic multi-agent](https://www.anthropic.com/engineering/multi-agent-research-system) ·
[Anthropic build effective agents](https://www.anthropic.com/research/building-effective-agents) ·
[Cognition don't-build](https://cognition.com/blog/dont-build-multi-agents) ·
[Cognition what's-working](https://cognition.com/blog/multi-agents-working) ·
[Factory missions arch](https://factory.ai/news/missions-architecture) ·
[Amp manual](https://ampcode.com/manual) · [Cursor agents](https://cursor.com/blog/agent-computer-use) ·
[GitHub Copilot agent](https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent) ·
[Conductor](https://www.conductor.build/) · [CodeRabbit](https://www.coderabbit.ai/) ·
[Stage](https://www.ycombinator.com/launches/QQz-stage-code-review-platform-for-humans-and-agents)

Methods & failure: [AG2 star](https://docs.ag2.ai/latest/docs/user-guide/advanced-concepts/pattern-cookbook/star/) ·
[MAST](https://arxiv.org/abs/2503.13657) · [More Agents](https://arxiv.org/abs/2402.05120) ·
[Stop Overvaluing MAD](https://arxiv.org/abs/2502.08788) · [ReAct](https://arxiv.org/abs/2210.03629) ·
[Self-Refine](https://arxiv.org/abs/2303.17651) · [Reflexion](https://arxiv.org/abs/2303.11366) ·
[CAMEL](https://arxiv.org/abs/2303.17760)

OSS & coordination: [LangGraph handoffs](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs) ·
[LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) ·
[Claude Agent Teams](https://code.claude.com/docs/en/agent-teams) ·
[Magentic-One](https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/) ·
[ECC team-agent-orchestration](https://github.com/affaan-m/ECC/blob/main/skills/team-agent-orchestration/SKILL.md) ·
[stablyai/orca](https://github.com/stablyai/orca) ·
[A2A spec](https://a2a-protocol.org/v0.3.0/specification/) ·
[Anthropic coordination patterns](https://claude.com/blog/multi-agent-coordination-patterns) ·
[GitHub merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

Expertise: [SWE-agent ACI](https://arxiv.org/abs/2405.15793) ·
[persona study](https://arxiv.org/html/2605.29420v1) · [context rot](https://www.trychroma.com/research/context-rot) ·
[CoALA](https://arxiv.org/html/2309.02427v3) · [demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) ·
[Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
