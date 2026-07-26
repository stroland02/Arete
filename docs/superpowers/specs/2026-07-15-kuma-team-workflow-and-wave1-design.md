# Kuma Engineering Team — Workflow / Mindset + Wave-1 Design

**Date:** 2026-07-15 · **Baseline:** `origin/main` @ `98e45d6` · **Prepared by:** Project-Manager [Main] session

This is one artifact on purpose: the **workflow** (how our agents build Kuma) and the
**mindset** (what Kuma is) are the same idea at two scales. Read §0 for the north star, §1
for the coordination framework, §2–§3 for what Wave 1 actually builds.

---

## 0. North Star — workflow *is* mindset

**Kuma — your AI Software Healing Engineer.**

- **Self-healing + self-growing.** Kuma doesn't just "run a prompt through a coding agent."
  It **heals** the codebase (finds and fixes what hurts) *and* **grows** it via
  state-of-the-art orchestration. Software as a **living organism**, not a pile of scripts.
- **The fractal (dogfooding).** The dev org that *builds* Kuma shares Kuma's anatomy. In our
  process, the **Project Manager [Main]** dispatches, correlates, and gates a team of
  **engineer-agents**. In the product, the **Synthesizer (the Cube)** is the
  PM-of-workflows and the agents are the engineers. Every coordination rule we prove on
  Engineers 1–3 is a rule the Cube runs over agents in-product. We get to dogfood the
  product by using it to build itself.
- **Always-current models.** Infrastructure that auto-connects the latest models/tech as
  they ship, so orchestration is never stale. (Direction; not a Wave-1 deliverable.)
- **Organized, scalable infra.** Keep structure clean and easy to improve so scaling later
  is cheap.
- **High craft, high social value.** A product so smooth and high-quality it touches
  people's hearts — aimed squarely at the software-engineering / developer crowd.
- **Long-horizon (not built now):** the agent *becomes* the codebase itself — you connect
  Git or local and the organism lives and evolves. This reframes what "programming" is; it
  shapes decisions, it is not a Wave-1 task.

---

## 1. Coordination framework — the workflow

### 1.1 Roles

| Role | Who | Owns |
|---|---|---|
| **PM / Integrator [Main]** | This session, on the `main` checkout | Dispatch, the `integration` branch, the gate, the PR. **Writes no feature code.** |
| **Engineer 1 / 2 / 3** | Persistent Kuma fleet sessions, each in its own workspace on branch `stroland02/Engineer-N` | Exactly one disjoint package-set per wave; feature code within it. |

### 1.2 Substrate & communication

- Workers are the **provisioned Kuma fleet Engineer sessions** — not ephemeral background
  subagents. The PM coordinates them via `SendMessage` (by name: `Engineer 1/2/3`); they
  reply to the PM (`main`).
- **Star topology, never mesh.** Engineers talk to the PM, never peer-to-peer. The PM is the
  only correlator. (This is the same primitive the Cube runs over agents in-product.)
- **One source of truth:** the ledger `.claude/ade-coordination.md` — ownership matrix,
  status, and every declared cross-package change. Nobody acts on stale state.
- **Uniform status contract.** Every engineer reports in the *same shape*, so the PM (and
  later the Cube) parses all agents identically:

  ```
  scope-confirmed → progress → blockers → done + how-I-verified
  ```

### 1.3 Ownership & conflict rules

- One package-set per engineer; disjoint across concurrently-running engineers.
- No edits outside your package without **declaring the cross-package change in the ledger
  first**.
- Shared files — `pnpm-lock.yaml`, `uv.lock`, `packages/webhook/src/types.ts`, Prisma
  schema — only the owning engineer edits; others declare first.
- A research task that later implements (Eng1) **declares each win's target package in the
  ledger before touching it**; if it lands in another engineer's package, it coordinates or
  defers rather than collide.

### 1.4 Integration model — integration branch + PM gate

The old **auto-merge-on-green** policy is **retired** — it is what let the junk-card bug
onto `main`. Nothing reaches `main` except through the gate + a human merge.

1. PM sends each engineer a **task brief**: scope, package boundary, acceptance criteria,
   verification command, and the north-star framing.
2. Engineer confirms scope → works on `stroland02/Engineer-N` → stays in its package →
   commits + pushes → runs its own package tests → reports done via the status contract.
3. PM builds a **fresh** local `integration` branch off latest `main` and merges each
   engineer branch. (Fresh each attempt — no partial/long-lived state.)
4. **The gate** (§1.5).
5. On green: push `integration`, open **one** PR `integration → main` with a verification
   report. **The human merges.**
6. Post-merge: PM updates the ledger; engineers rebase onto new `main` for the next wave.

### 1.5 The gate — explicit verification bar

Both halves are required. Green tests alone are not sufficient (this wave's lesson: the
junk-card bug passed every build).

- **Full test matrix**
  - `pnpm --filter @arete/webhook test`
  - `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py`
  - `pnpm --filter @arete/dashboard build` **and** `pnpm --filter @arete/dashboard test`
- **Drive the real affected flow** — actually exercise what changed, not just build-green.

### 1.6 Error handling

- **Merge conflict** at integration → PM resolves if trivial; otherwise bounces the specific
  hunk back to the owning engineer, never guesses.
- **Gate failure** (red test *or* broken flow) → PM does **not** open the PR; sends failing
  evidence to the responsible engineer, who fixes on-branch and re-signals. Integration
  branch is rebuilt fresh.
- **Cross-worker dependency** → routes through the PM, not peer-to-peer, so ownership stays
  legible.
- Carried disciplines: no fabricated data; honest empty states; log unexplained anomalies
  instead of symptom-fixing.

---

## 2. Wave-1 assignments

The live pair is **Engineer 1 + Engineer 2** (disjoint). **Engineer 3 is deferred**,
blocked-by Engineer 1.

### Engineer 1 — "SuperLog Study"

- **Deliverable A (research):** Work through SuperLog's docs (`https://superlog.sh/`,
  `https://docs.superlog.sh/introduction`, and onward — concepts, getting-started,
  integrations, features), **page by page**. The user pastes each doc's text into Engineer
  1's session between prompts so it works sequentially. For each concept/strategy/
  integration/feature: analyze how SuperLog built it, then evaluate what Areté should
  **adopt / adapt / improve on / deliberately skip**, grounded in the extra services and
  quality Areté already provides. Output: a decision-ranked proposal at
  `docs/research/superlog-integration-analysis.md`.
- **Deliverable B (implement the clear wins):** Immediately implement the high-confidence,
  low-risk items; **defer debatable items to the user.** Declare each win's target package
  in the ledger *before* editing (§1.3). Implemented wins go through the full gate (§1.5);
  the proposal doc itself is reviewed with the user.
- **Note:** Eng1's CLI / background-services / "set up and forget" findings become the input
  that defines Engineer 3 — hence Eng3's deferral.

### Engineer 2 — "Sensorium"

- **Type:** production **service / data-integration** task — *not* a visual redesign. Reuse
  the existing dashboard design system.
- **Scope:** Make the **authenticated dashboard home** (`/overview`) a live map of the
  codebase, rendered **fully by us** (see §3 for the node/sensor model):
  1. Integrate `codebase-memory-mcp` (`https://github.com/DeusData/codebase-memory-mcp`) —
     index the repo, and **consume its graph via its query tools** (`get_architecture`,
     `query_graph`, `search_graph`, `trace_path`, `detect_changes`). Do **not** merely embed
     the MCP's own 3D viewer.
  2. Render our own Sensorium component from that graph data.
  3. Overlay **our live sensor data** on the nodes (§3 table).
- **Owns:** `packages/dashboard` (+ any service glue to reach the MCP). Honest empty states
  where a sensor's data source isn't live yet.
- **Gate:** full matrix + **drive the real flow** — the map renders from a real index with
  at least one real sensor overlay populated (not mocked).

### Engineer 3 — deferred (blocked-by Engineer 1)

Scope intentionally not fixed. It will be specced from Engineer 1's SuperLog proposal —
likely the CLI integrations + a GitHub-native connect/onboarding path (studying Orbit's
"connect an agent → it runs the setup" flow) — designed to **complement** what Eng1 builds,
not duplicate it. Idle this wave.

---

## 3. Sensorium — node / sensor model

**The nodes are the organism's *body*; the sensors are its *vital signs*.**

- **Nodes (body / anatomy)** = the `codebase-memory-mcp` knowledge graph as-is:
  `Project → Package → Folder → File → Module → Class → Function → Method` (plus
  `Interface / Enum / Type`, and infra nodes `Route`, `Resource`, Dockerfiles, K8s
  manifests). Edges: `CALLS`, `IMPORTS`, `IMPLEMENTS`, `INHERITS`, `DATA_FLOWS`, `TESTS`,
  `HTTP_CALLS`, `SIMILAR_TO`, `SEMANTICALLY_RELATED`. The MCP provides this; we consume it.
- **Sensors (vitals / overlays)** = Areté's own signals painted onto those nodes. This is
  the layer the MCP does not have and where our extra services show up — it is what makes
  Sensorium *ours* and embodies the healing-engineer positioning.

| Sensor | A node lights up when… | Fed by |
|---|---|---|
| **Pain / health** | it has an unresolved review finding or high `detect_changes` risk | 6-agent review findings + MCP risk classification |
| **Healing-in-progress** | an agent is actively working/fixing it right now | OTel spans on the LangGraph agents (`c37fb60`) |
| **Heat / churn** | it changed recently or often (hotspot) | MCP `get_architecture` hotspots + git |
| **Vitality / exposure** | it has no incoming `TESTS` edge (untested = vulnerable) | MCP `TESTS` edges |
| **Necrosis** | it is unreachable dead code (prune candidate) | MCP dead-code detection |
| **Pulse** | overall system throughput / heartbeat | ClickHouse `getAgentEventsPerMinute` |

The landing home reads as: *here is the living body of your codebase; here is where it
hurts, where it's being healed, where it's exposed — and you can watch the agents move
across it in real time.* All overlays are real-data-backed; where a source isn't live yet,
show an honest empty state, never fabricated data.

---

## 4. Constraints & non-goals this wave

- **Frozen:** the **advertise / pre-login marketing landing page** (the shipped Marble/Ink
  site). No engineer touches it. "We are done with visuals" applies to that surface.
- **Open to improve:** every **authenticated product interface / service UI** behind login,
  including the dashboard home (Sensorium). Improvement here is welcome and expected.
- **No net-new visual design system.** Reuse the shipped design system; the wave's effort
  goes to making **services production-ready**, not re-styling.
- **Production bar:** real data, honest empty states, no fabrication, tested + driven.

---

## 5. Open / deferred items

- **Orbit reference** (the connect-an-agent onboarding UX to study) — deferred with
  Engineer 3.
- **Sensor data availability** — some sensors depend on services being live (ClickHouse
  `clickhouse` compose service up; OTel wired). Sensorium shows honest empty states for any
  sensor whose source isn't running yet; wiring those sources may itself become later-wave
  work.

---

## 6. Disciplines carried forward (from Build Wave 1)

Fetch fresh `origin/main` before building (it moves). Cherry-pick/rebase, never merge a
stale branch. Claim one surface per engineer. **Verify by driving the real flow, not just a
green test.** No fabricated data; honest empty states. Log unexplained anomalies instead of
symptom-fixing.
