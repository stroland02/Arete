# @arete/orchestration

A pure, framework-agnostic **model** of Kuma's star-topology work floor — the same coordination
primitive the product's Synthesizer ("the Cube") runs over its agent fleet. Mirrors
[`@arete/topology`](../topology): dependency-free types + pure functions, no runtime/IO, with a
**driver seam** for a real backend later.

See the design: [`docs/superpowers/specs/2026-07-15-orchestration-substrate-design.md`](../../docs/superpowers/specs/2026-07-15-orchestration-substrate-design.md)
and the research: [`docs/research/orchestration-landscape-analysis.md`](../../docs/research/orchestration-landscape-analysis.md).

## What's here (v1 — model + seam only)

| Module | Models |
|---|---|
| `roles.ts` | Typed roles (`orchestrator` / `worker` / `integrator`) + capability predicates |
| `status.ts` | The status contract as a state machine: `scope-confirmed → progress ⇄ blockers → done` (done requires verification) |
| `ledger.ts` | Task ledger + **proactive lane-conflict detection** (our differentiator — detected before work, not at merge) |
| `gate.ts` | Integration gate: `pending → verifying → verified/blocked → merged`; only a **human** approval merges ("no agent message is consent") |
| `messages.ts` | Star-topology message envelope + `route()` enforcing the star invariant (workers ↔ hub only); kinds include `handoff` / `qa-result` and an optional `specialty` tag |
| `driver.ts` | `OrchestrationDriver` seam + `InMemoryDriver` reference implementation |

## Phase A — work-floor extensions (the PM-distributor + QA loop)

Additive model for [`docs/superpowers/specs/2026-07-15-kuma-work-floor-orchestration-design.md`](../../docs/superpowers/specs/2026-07-15-kuma-work-floor-orchestration-design.md) — the product's
"a problem enters → PM-agent analyzes and dispatches → specialists → QA validates → Synthesizer → PR".

| Module | Models |
|---|---|
| `specialty.ts` | The specialist roster (`reproduction` / `root-cause` / `fix-author` / `test-author` / `security` / `reviewer` / `qa`) — worker disciplines, not new roles |
| `dispatch.ts` | `DispatchPlan` (the PM-agent's analysis + typed assignments) + `planToTasks()` → feeds the existing ledger's lane-conflict detection + `claimable()` |
| `qa.ts` | The QA validation loop: `advanceQaLoop()` (pass → synthesize; fail → re-dispatch with the exact error; bounded by `maxPasses`, default 3, then escalate to the human gate — never loops) |
| `transcript.ts` | Pure `Envelope → transcript-event` projection onto the dashboard's existing `SynthStep` vocabulary, so inter-agent messages ride the **existing** SSE stream (no second stream) |

## Deferred (documented seams, NOT built this round)

- **Phase B (agents lane):** the Python **`LangGraphDriver`** + new specialist agents conform to the
  **frozen TS contract above** (PM ruling Q1: orchestration runs as a LangGraph graph in the agents
  service; this package is canonical). `ClaudeAgentSdkDriver` similarly implements `OrchestrationDriver`.
- **Phase C (dashboard lane):** surfacing the transcript on the agents-chat page via the existing
  SSE stream — coordinate with the Glass Box cockpit so it is one stream.
- Also deferred: message persistence, real git/CI gate execution, stall-detection/replan, the
  worker-expertise eval loop, and the QA validation harness wiring (PM ruling Q2).

## Develop

```
pnpm --filter @arete/orchestration test        # node:test via tsx
pnpm --filter @arete/orchestration typecheck
pnpm --filter @arete/orchestration build
```
