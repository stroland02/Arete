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
| `messages.ts` | Star-topology message envelope + `route()` enforcing the star invariant (workers ↔ hub only) |
| `driver.ts` | `OrchestrationDriver` seam + `InMemoryDriver` reference implementation |

## Deferred (documented seam, NOT built this round)

`ClaudeAgentSdkDriver` and `PythonSynthesizerDriver` implement the same `OrchestrationDriver`
interface later — the model doesn't change, only the transport. Also deferred: message transport,
persistence, real git/CI gate execution, stall-detection/replan, and the worker-expertise eval loop.

## Develop

```
pnpm --filter @arete/orchestration test        # node:test via tsx
pnpm --filter @arete/orchestration typecheck
pnpm --filter @arete/orchestration build
```
