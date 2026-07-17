# Orchestration Substrate (`@arete/orchestration`) — v1 Design

**Date:** 2026-07-15 · **Base:** `main` @ `76246ef` · **Prepared by:** Engineer 2 (`feat/orchestration-study`)
· **Research:** [`orchestration-landscape-analysis.md`](../../research/orchestration-landscape-analysis.md)
· **Models the workflow in:** [`2026-07-15-kuma-team-workflow-and-wave1-design.md`](./2026-07-15-kuma-team-workflow-and-wave1-design.md)

## 1. Purpose & non-goals

`@arete/orchestration` is a **pure, framework-agnostic model** of the star-topology work floor —
the same primitive the product's Synthesizer ("the Cube") will run over agents. It mirrors
`@arete/topology`'s shape: dependency-free types + pure functions, no runtime/IO, a **driver seam**
for a real backend later. It is the *dogfooding* substrate: encode the coordination rules we prove
on Engineers 1–3 so the Cube can run them in-product.

**v1 builds (model + seam only):** typed roles; the status contract as a state machine; a task
ledger with lane-conflict detection; an integration-gate model; a star-topology message contract;
a driver seam with an in-memory reference driver.

**v1 explicitly does NOT build (YAGNI):** any real backend wiring, a message transport,
persistence, an eval harness, skill self-improvement, a UI, or `git`/CI execution. The
**Python-Synthesizer and Claude-Agent-SDK drivers are a documented, deferred seam** — same
discipline as Sensorium's provider seam.

**Guardrails:** new package, exclusively Engineer 2's. No edits to `packages/agents`,
`packages/webhook`, `packages/dashboard`, or `server.py`.

## 2. Rejected alternatives (from the research)

- **Mesh / GroupChat broadcast / Swarm handoffs** — undermine auditability + the single gate; peer
  channels enlarge the MAST "inter-agent misalignment" surface. We are deliberately star.
- **Peer debate** — evidence shows it underperforms self-consistency at higher cost; also violates
  no-peer-comms.
- **A2A / AGNTCY** — solve cross-vendor/untrusted-agent interop we don't have. Our envelope is
  lean; A2A-style transport binding can wrap it later if ever needed.
- **MetaGPT-style baked-in SOP** — we want a model, not a hard-coded pipeline.

## 3. Package layout (mirrors `@arete/topology`)

```
packages/orchestration/
  package.json            # @arete/orchestration; tsx --test; nodenext; build via tsconfig.build.json
  tsconfig.json           # extends repo conventions (noEmit, strict, nodenext)
  tsconfig.build.json     # declaration output, excludes *.test.ts
  README.md
  src/
    roles.ts     roles.test.ts       # typed roles + capability predicates
    status.ts    status.test.ts      # status contract state machine
    ledger.ts    ledger.test.ts      # task ledger + lane-conflict detection
    gate.ts      gate.test.ts        # integration-gate model
    messages.ts  messages.test.ts    # star-topology message envelope + router
    driver.ts    driver.test.ts      # driver seam + in-memory reference driver
    index.ts                         # barrel (export * from "./x.js")
```

Conventions carried from `@arete/topology`: `type: module`, `nodenext` ⇒ **`.js` import
extensions**, tests use `node:test` + `node:assert/strict` run via `tsx --test src/*.test.ts`.

## 4. Module APIs

### 4.1 `roles.ts`

```ts
export type Role = "orchestrator" | "worker" | "integrator";
export interface RoleCapabilities {
  canDispatch: boolean;   // assign tasks to workers
  canReport: boolean;     // emit status reports
  canGate: boolean;       // approve/verify at the integration gate
}
export const ROLE_CAPABILITIES: Record<Role, RoleCapabilities>;
export function can(role: Role, capability: keyof RoleCapabilities): boolean;
```
`orchestrator` = dispatch+gate; `worker` = report; `integrator` = gate (+report). (PM and
Integrator may be one actor in the human workflow; the product may split them — hence three roles.)

### 4.2 `status.ts` — the status contract as a state machine

```ts
export type StatusPhase = "scope-confirmed" | "progress" | "blockers" | "done";
export interface Verification { matrix: boolean; droveRealFlow: boolean; evidence: string; }
export interface StatusReport {
  phase: StatusPhase;
  note: string;
  verification?: Verification;   // required to enter "done"
}
export type TransitionResult =
  | { ok: true; phase: StatusPhase }
  | { ok: false; reason: string };

// Allowed: (initial) → scope-confirmed → progress ⇄ blockers → done.
export function transition(from: StatusPhase | null, report: StatusReport): TransitionResult;
export const TERMINAL_PHASE: StatusPhase; // "done"
```
Rules (counter MAST cat. 1 & 3): first report must be `scope-confirmed`; `done` requires
`verification.matrix && verification.droveRealFlow` (green tests alone are insufficient — the
team-workflow gate rule); `done` is terminal.

### 4.3 `ledger.ts` — task ledger + lane conflict

```ts
export type KanbanState =
  | "backlog" | "ready" | "running" | "review" | "blocked" | "merged" | "archived";
export interface Lane { packages: string[]; globs: string[]; } // declared file-ownership
export interface TaskEntry {
  id: string;
  title: string;
  owner: string;            // worker id
  lane: Lane;
  state: KanbanState;
  phase: StatusPhase | null;
  dependsOn: string[];      // task ids
  evidence?: string;
}
export interface LaneConflict { a: string; b: string; overlap: { packages: string[]; globs: string[] }; }

export function activeTasks(entries: TaskEntry[]): TaskEntry[];      // running|review|blocked
export function detectLaneConflicts(entries: TaskEntry[]): LaneConflict[]; // overlap among active
export function claimable(entries: TaskEntry[], id: string): boolean;     // deps merged, state ready
```
Lane overlap = shared package OR overlapping glob prefix, evaluated **only among concurrently
active** tasks (our differentiator: detected *before* work, not at merge). `merged`/`archived`
tasks never conflict.

### 4.4 `gate.ts` — integration gate

```ts
export type GateState = "pending" | "verifying" | "verified" | "blocked" | "merged";
export interface GateBatch { taskIds: string[]; state: GateState; }
export interface Approval { by: string; role: Role; human: boolean; } // human/PM consent token

// Deterministic transitions modeling merge-queue mechanics:
export function beginVerify(batch: GateBatch): GateBatch;               // pending → verifying
export function recordResult(batch: GateBatch, allGreen: boolean): GateBatch; // → verified | blocked
export function merge(batch: GateBatch, approval: Approval): GateBatch | { ok: false; reason: string };
```
`merge` succeeds **only** from `verified` **and** with `approval.human === true` ("no agent message
is consent" — MAST cat. 3; the team-workflow "human merges" rule). An agent/non-human approval is
rejected.

### 4.5 `messages.ts` — star-topology message contract

```ts
export interface Party { role: Role; id: string; }
export type MessageKind = "dispatch" | "status" | "blocker" | "gate-request" | "gate-result";
export interface Envelope {
  id: string; traceId: string;
  from: Party; to: Party;
  kind: MessageKind;
  phase?: StatusPhase;
  laneClaims?: Lane;
  cost?: { tokens: number };
  body: string;
}
export type RouteResult = { ok: true } | { ok: false; violation: string };

// Enforces the star invariant: workers may only address the hub (orchestrator/integrator),
// never another worker. Hub may address any worker. Rejects worker↔worker.
export function route(env: Envelope): RouteResult;
export const HUB_ROLES: readonly Role[]; // ["orchestrator", "integrator"]
```

### 4.6 `driver.ts` — the seam

```ts
export interface OrchestrationDriver {
  dispatch(task: TaskEntry): Promise<void>;
  send(env: Envelope): Promise<void>;
  drain(): Promise<Envelope[]>;     // messages emitted back to the hub
}
export class InMemoryDriver implements OrchestrationDriver { /* reference impl for tests/local */ }
```
The in-memory driver validates every `send` through `route()` (star invariant enforced at the
seam) and records dispatched tasks. **Deferred drivers (documented, not built):** a
`ClaudeAgentSdkDriver` (mailbox/`SendMessage`) and a `PythonSynthesizerDriver` (HTTP/queue to the
LangGraph backend) implement this same interface later — the model doesn't change, only the
transport, exactly as A2A separates data model from transport.

## 5. Test plan (TDD)

Each module gets a colocated `*.test.ts` (`node:test`), written before implementation:
- **roles:** capability matrix; `can()` for each role.
- **status:** first-must-be-scope-confirmed; progress⇄blockers; done requires full verification;
  done is terminal; illegal transitions rejected with reason.
- **ledger:** active filter; lane conflict on shared package and on glob-prefix overlap; no
  conflict for merged tasks; `claimable` gated by deps + ready.
- **gate:** happy path pending→verifying→verified→merged; blocked on red; merge rejected when not
  verified; merge rejected without human approval.
- **messages:** hub→worker ok; worker→hub ok; worker→worker rejected; envelope carries traceId/phase.
- **driver:** InMemoryDriver dispatch records; send enforces `route()` (peer-to-peer rejected);
  drain returns hub-bound messages.

**Verification (the gate for this task):** full package test matrix green (`pnpm --filter
@arete/orchestration test` + `typecheck` + `build`) **and** drive the real flow — a small
end-to-end script exercising dispatch → worker status reports through the state machine → lane
check → gate verify → human-approved merge, proving the modules compose (not just unit-pass).

## 6. Deferred seam (next wave, not now)

- **Drivers:** `ClaudeAgentSdkDriver`, `PythonSynthesizerDriver`.
- **Transport & persistence:** message bus (Redis Streams / DB queue), ledger persistence.
- **Automation:** real `git` worktree/branch ops, CI-backed gate execution (merge-queue batch
  build), stall-detection/replan (Magentic-One), an eval harness + skill self-improvement for
  worker expertise.
- **Product wiring:** the Synthesizer/Cube consuming this model to orchestrate in-product.
