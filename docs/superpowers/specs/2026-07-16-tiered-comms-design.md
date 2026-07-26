# Tiered Agent Communications — Fabriq-Formalized Star-Topology (2026-07-16)

**Idea (user):** make agent↔synthesizer communication act like a corporate
communication structure — everyone stays in the loop with the most relevant
information, no lag or miscommunication, problems are clear and solved
efficiently. Reference software: **Fabriq** (fabriq.tech), a shop-floor
operational-excellence platform.

**Approved approach:** formalize the EXISTING star-topology — no new tier
objects, no new transport, no DB change. Three additions on top of
`packages/orchestration` + the existing SynthStep SSE + Glass Box.

---

## 1. The Fabriq → Kuma mapping (research summary)

Fabriq implements manufacturing communication discipline: **tiered meetings /
short-interval management** (status rolls up operator → team lead → director),
**escalation before problems worsen**, **visual management** (one live board
everyone reads), **SQCDP KPIs**, **action plans + problem history**, and
**structured updates over noisy chatter**.

| Fabriq | Kuma (exists today) |
|---|---|
| Operator → lead → director tiers | Specialists → Synth/PM → Human (HITL gate) |
| Tiered-meeting status update | `SynthStep` report vocabulary |
| Escalation ladder | ⚑ flag off `critic.DEFAULT_LOW_CONFIDENCE` |
| Visual management board | Glass Box cockpit + Services Synth stream |
| SQCDP KPIs | The 6 review dimensions |
| Problem history / action plans | `IssueContainer` + findings + `AgentMemory` |
| "Reduce excessive emailing" | Star-topology: all messages route through PM |

The flow stays: `Specialist → (structured status) → Synth/PM → (escalate if
low-confidence) → Human`.

## 2. Component A — StatusReport schema

A fixed report shape every specialist emits when reporting through the PM —
the "tiered-meeting update." Formalizes (does not replace) the existing
`report` SynthStep kind.

```
StatusReport {
  agent:      string          // specialist id
  dimension:  ReviewDimension // one of the 6 — the SQCDP analog
  status:     "on_track" | "blocked" | "needs_input" | "escalating" | "done"
  summary:    string          // the single most-relevant line
  confidence: number          // REAL, from the agent/critic — never synthesized
  blockers:   string[]        // bottom-up "what I need" signal (may be empty)
}
```

Lives in `packages/orchestration` as a typed schema + validator. The driver
(dashboard `issue-pipeline/driver.ts`) carries it inside the existing SynthStep
payload — **no new step kinds**, so Fable's console renderer is untouched.

## 3. Component B — Escalation ladder

Pure, deterministic functions in `packages/orchestration` (no LLM judgment):

1. `status ∈ {on_track, done}` AND `confidence ≥ DEFAULT_LOW_CONFIDENCE`
   → rolls up as a normal report.
2. `confidence < DEFAULT_LOW_CONFIDENCE` OR `status ∈ {blocked, needs_input}`
   → **escalate to Synth/PM** (report-level generalization of the ⚑ flag).
3. Synth cannot compose a confident solution → **escalate to Human**: the
   container holds at `ready` with the escalation surfaced; only the human
   gate (`solution_approved`) crosses it. HITL moat unchanged.

Same threshold source as the ⚑ flag — one constant, two consumers.

## 4. Component C — Situational-awareness board

One live view showing every tier at once, projected over the **existing SSE
stream** (`containers/[id]/stream`) — no new transport:

- Per-specialist: latest status pill, dimension, confidence, top blocker.
- Open escalations (who escalated, why, to which tier).
- The Synth's aggregate line.

**Placement: folded into the existing surfaces** (Services Synth panel +
Glass Box), not a new screen — the human watches the same stream the agents
post to.

## 5. Data flow

specialist emits StatusReport → driver/synth aggregates → escalation rule
assigns tier → existing SynthStep SSE → board projection → human.

## 6. Ownership (current lanes, no reassignment)

- **Eng2** (`packages/orchestration` + dashboard shared-additive):
  StatusReport schema + validator, escalation-ladder pure functions, driver
  emission, board projection/rendering.
- **Eng3** (`packages/agents`): specialists populate REAL
  status/confidence/blockers when reporting — rides on the fix-gen work.
- **Eng1**: nothing in v1 (no DB change). Problem-history persistence is a
  later tie-in to `IssueContainer`, explicitly deferred (YAGNI).

## 7. Error handling & integrity

- **Anti-fabrication:** status/confidence come from the agent + critic —
  never synthesized for display. A specialist that fails to report shows as
  absent/stale on the board, never as a fake "on_track."
- Malformed StatusReport → validator rejects → surfaced as `blocked` with the
  validation error as the blocker (honest degradation, never dropped silently).
- Escalation is deterministic and unit-testable; no judgment calls in code.
- HITL moat and tenancy scoping unchanged.

## 8. Testing

TDD throughout, matching package style: escalation-ladder unit tests (every
branch), StatusReport schema validation tests, driver-emission tests (reports
ride existing step kinds), board-projection tests over a synthetic stream.

## 9. Out of scope (v1)

Persistent report history (needs `IssueContainer`), scheduled "huddle"
aggregation steps, Tier/Huddle as first-class objects, SQCDP KPI dashboard
tiles, cross-review problem-history analytics.
