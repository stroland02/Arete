# Synthesizer — real component + hybrid Critic — design spec

**Status:** design · 2026-07-13 · branch `feat/marble-ink-foundation`
**Builds on:** `2026-07-13-issue-container-and-pr-pipeline.md` (the Issue
Container model, the two-door/two-gate contract, the pipeline stages). This
spec turns the **approved Synthesizer "thinking" mockup** (artifact `8ee4f4d7`)
into the real production component and defines the **hybrid verification brain**
behind it.
**Approved decisions (2026-07-13):** hybrid verifier (rule gate + LLM Critic);
ship the component + streaming contract now, live AI next; **live-only** motion;
"surface + reasons" human gate.

---

## 1. The honesty invariant — the Critic can only narrow, never expand

The verification brain is a **two-stage funnel**. The order and the containment
relationship are the whole trust story:

```
candidates (from the 6 specialist agents)
      │
      ▼
 ① DETERMINISTIC GATE   keep iff finding.file:line ∈ diff        (pure fn — today's isEvidencedByDiff)
      │  gatePassed ⊆ candidates
      ▼
 ② LLM CRITIC           reasons about each gate-passed finding    (separate Claude model)
      │                 against the diff/code → uphold | drop, rationale, confidence
      │  kept ⊆ gatePassed         ← the Critic may only DROP or FLAG, never resurrect
      ▼
 ③ COMPOSE PR           one review comment per kept finding
```

**Containment law:** `kept ⊆ gatePassed ⊆ candidates`.

Consequences (these are the reasons for this ordering):

- **No-fabrication (aletheia) stays a pure, deterministic property.** A `kept`
  finding always has a real `file:line` in the diff, provable without trusting
  the model. `assertNoFabrication` remains a hard invariant and a property test.
- **The model adds intelligence on top of a guarantee it cannot break.** The
  Critic can *subtract* (drop a finding whose reasoning doesn't hold up) or
  *annotate* (flag low confidence for a human), but it can never add a finding
  the gate rejected. A model hallucination can at worst drop a real finding
  (a miss, surfaced), never invent a fake one (a fabrication, forbidden).
- **The UI copy "a separate model verifies each finding" becomes literally
  true** — the Critic is a real, separate model — while the invariant that
  makes Areté trustworthy is independent of it.

### Relationship to the pipeline spec (§4.5 / §5 amendment)

The existing pipeline spec says "verification is a pure function." That remains
exactly true **of the gate**. This spec refines it: the gate is the pure,
deterministic, replayable function; the **Critic is a separate layer that can
only narrow the gate's output**, is **cached by `(findingId, diffHash)`** so a
replay is stable, and is contract-tested against **recorded fixtures** rather
than asserted bit-identical. `verifyAll` today already emits the ordered
`SynthStep[]` transcript; the Critic appends its `uphold`/`drop` reasoning steps
into that same transcript. No existing pipeline test changes meaning.

---

## 2. The transcript is the product

`SynthStep[]` (spec §3 of the pipeline spec) is append-only and ordered — it
*is* what the console renders. The component is **driven by the stream of
`SynthStep`s**, never by a hardcoded script. Step `kind`s map to rendered lines:

| `kind` | rendered as |
|---|---|
| `dispatch` | "6 specialists dispatched…" (phase: fanning_out) |
| `report` | an agent's rail node lights up; "security reported 3 candidates" |
| `verify` | a candidate line appears with a *verifying…* spinner |
| `keep` | that line resolves ✓ **Kept** — with its `file:line` |
| `drop` | that line resolves ✗ **Dropped** — with the `droppedReason` |
| `compose` | "composing review — N comments" (phase: composing) |
| `posted` | success card (phase: ready → the human gate) |

A step whose finding was gate-passed but Critic-flagged low-confidence renders
as a **"wants a human look"** line carrying the reason (the "surface + reasons"
decision).

---

## 3. Component structure

Replaces the static `synthesizer-console.tsx` with a focused folder under
`components/dashboard/agents/synthesizer/`. Each file has one responsibility and
is independently testable.

| File | Responsibility | Depends on |
|---|---|---|
| `synth-phase.ts` | derive `phase` + progress fraction from a container's `state` + steps; pure | types |
| `use-synth-stream.ts` | client hook: subscribe to a container's transcript stream (SSE); return `{ phase, steps, agents, prState, kept, dropped, needsAttention }` | EventSource |
| `synth-progress.tsx` | top phase bar (fanning_out → verifying → composing → ready) | synth-phase |
| `synth-agents-rail.tsx` | left: the 6 agents; each lights up on its `report` step | agent-catalog |
| `synth-transcript.tsx` | center: the streamed lines; per-candidate *verifying…* → ✓ Kept / ✗ Dropped / ⚑ needs-look, grounded in real `file:line` | types, lib/motion |
| `synth-ledger.tsx` | right: verified/dropped counters + the **Ready for your approval** card | types |
| `synthesizer-console.tsx` | **Agents variant** (detailed) — assembles rail + transcript + ledger + progress | all above |
| `synthesizer-summary.tsx` | **Services variant** (big-picture) — progress + "Agents are solving this — X of Y verified" + deep-link to the focused Agents view | synth-phase |

Both variants are **projections of the same container/stream** — they never hold
independent state (pipeline spec §5, single source of truth).

### Two variants, one source

- **Agents-detailed** (`synthesizer-console.tsx`) — the full 3-region console:
  agents rail, streaming transcript, ledger. This is the center pane of
  `agents-workspace.tsx`; it replaces the current `SynthesizerConsole`.
- **Services-big-picture** (`synthesizer-summary.tsx`) — a condensed card for
  the Services issue view: phase progress, `X of Y verified`, and a deep-link
  `→ Agents` (the handoff in pipeline spec §4/§6.5). No transcript detail.

---

## 4. States & motion (live-only)

`phase` is derived (`synth-phase.ts`) from `container.state`:

| container.state | phase | motion |
|---|---|---|
| detecting | `idle` | none |
| fanning_out / verifying / composing | `working` | **animate** — stream steps in, spinners resolve |
| ready | `ready` | settle → raise the approval card, then static |
| solution_approved / posted / changes_requested / merged | `done` | **final ledger, no motion** |
| dismissed | `dismissed` | static, muted |

- **Live-only** (the decision): motion happens *only* while `phase === "working"`.
  A finished container renders its final ledger with no animation. A `replay`
  affordance is **out of scope** for this build.
- `prefers-reduced-motion` → skip all transitions, render the final state
  directly (steps appear complete, no spinners).
- Because the live Critic is the *next* step, this build feeds the same real SSE
  path from a **clearly-labeled sample producer** in dev (`?sample=1` or a
  `SAMPLE` container id). The component contains **no script** — it always
  consumes the stream; only the *producer* is sample data, and it is labeled as
  such in the UI (a "Sample" chip), never presented as a real review.

### Human-gate surface ("surface + reasons")

- At `phase === "ready"`, `synth-ledger` raises a prominent card:
  - Agents variant → **Approve solution** (gate 1; disabled until the backend
    gate is wired, matching today's honest disabled shell).
  - Services variant (in `synthesizer-summary` / the Services PR panel) →
    **Post PR** (gate 2).
- `needsAttention` = any gate-passed finding the Critic flagged low-confidence.
  Each renders inline in the transcript as **⚑ wants a human look** + the reason,
  and increments a count on the ledger ("2 want your eyes"). This is how the
  console "communicates when things need checking."

---

## 5. Tech stack

### 5.1 Streaming transport — SSE

A Next route handler streams a container's transcript:

```
GET /api/containers/[id]/stream   → text/event-stream
```

- **SSE, not WebSocket:** the transcript is append-only and one-directional —
  server → client. SSE over HTTP is the right primitive; no bidirectional
  channel is needed. Node runtime (`export const runtime = "nodejs"`).
- Each `SynthStep` is one `data:` event (`event: step`). A terminal
  `event: done` closes the stream when `phase` reaches `ready`/`done`.
- Tenancy: the route resolves the container by `id` **scoped to the caller's
  `installationId`** (existing auth convention); not-found and not-authorized
  return uniformly (pipeline spec §5).
- Swappable: if the repo later adopts a realtime provider, `use-synth-stream`
  is the only consumer to change.

### 5.2 The store — interface now, DB later

```ts
interface ContainerStore {
  get(installationId: string, id: string): Promise<IssueContainer | null>;
  subscribe(id: string, onStep: (s: SynthStep) => void): () => void;
}
```

- In-memory / sample implementation now (the `SAMPLE_ISSUES` in
  `services-workspace.tsx` become fixtures conforming to `IssueContainer`).
- `@arete/db` is a drop-in later (pipeline spec §6.1, single-owner schema) —
  the component and route never change.

### 5.3 The Critic — spec'd now, built as the immediate next step

`lib/issue-pipeline/critic.ts` (server-only):

```ts
interface CriticVerdict { verdict: "uphold" | "drop"; rationale: string; confidence: number }
async function criticReview(finding: Finding, diff: Diff, evidence: EvidenceRow[]): Promise<CriticVerdict>
```

- Runs **only on gate-passed findings** (`isEvidencedByDiff` true). Enforced in
  code: the caller filters through the gate first; `criticReview` output is used
  only to move `uphold → kept` or `drop → dropped`, so `kept ⊆ gatePassed` holds
  structurally.
- **Model:** a strong Claude model (Opus-class) — this is the product's
  code-review brain. *Note:* the memory's "Fable" preference governs **my** UI
  subagent dispatch, not the shipped product's Critic; the product Critic is a
  separate decision (Opus-class for review quality). Model id is config, not
  hardcoded (`SYNTH_CRITIC_MODEL`).
- **Prompt contract:** given `{ diff, finding (agentId, category, file:line,
  rationale), evidence }`, return strict JSON `CriticVerdict`. The model judges
  *whether the finding's reasoning actually holds against the changed code* — it
  does not get to invent new findings or new locations.
- **Caching / determinism:** memoized by `(finding.id, diffHash)`; a replay of
  the same review yields the same verdicts. Contract-tested against **recorded
  fixtures** (a set of `{finding, diff} → CriticVerdict` cases), not asserted
  identical to a live call.
- **Failure mode:** if the Critic errors or times out, the finding is **kept**
  (the gate already proved it real) and flagged `needsAttention` ("Critic
  unavailable — verify manually"). A model outage degrades to the deterministic
  gate, never to fabrication or to dropping real findings silently.

> Implementation of the live model call is the following session's connector
> work; this spec fixes its contract, its invariants, and its tests so the
> component and the pipeline are built against a stable interface now.

---

## 6. Integrity · SWE · QA (this build)

- **Single source of truth:** both variants read one container/stream; PR state
  is one field (pipeline spec §5).
- **Provenance:** every transcript line carries `agentId` + `findingId`; every
  `keep`/`drop` carries the `file:line` / reason.
- **No fabrication:** `assertNoFabrication` + the containment property test
  (`kept ⊆ gatePassed ⊆ candidates`).
- **Honesty in UI:** sample data wears a "Sample" chip; empty states stay empty;
  the Approve/Post controls stay disabled shells until their backend gates exist
  (matching the current pr-panel honesty).
- **Tenancy:** the SSE route filters on `installationId`; uniform not-found.

**Tests (must pass before this build merges):**
- `synth-phase` derivation: each `ContainerState` → correct phase + progress.
- containment property test: for random candidate/diff/critic-verdict sets,
  `kept ⊆ gatePassed ⊆ candidates` always holds.
- Critic-narrowing invariant: a Critic `uphold` on a gate-*failed* finding can
  never produce a `kept` (structurally impossible via the caller).
- stream ordering: `use-synth-stream` preserves `SynthStep` order; a `done`
  event closes it.
- reduced-motion: renders the final state with no spinners.
- Critic fixtures (added with the Critic build): recorded `{finding,diff}` cases
  → expected `CriticVerdict`.

---

## 7. Build order

1. `synth-phase.ts` (pure) + its tests.
2. SSE route `/api/containers/[id]/stream` + the `ContainerStore` interface +
   in-memory sample impl (fixtures from `SAMPLE_ISSUES`) + the sample producer.
3. `use-synth-stream.ts` hook + ordering test.
4. Presentational pieces: `synth-progress`, `synth-agents-rail`,
   `synth-transcript`, `synth-ledger` (+ reduced-motion test on transcript).
5. `synthesizer-console.tsx` (Agents variant) — wire into `agents-workspace.tsx`,
   replacing the current `SynthesizerConsole` (preserve its props or adapt the
   workspace).
6. `synthesizer-summary.tsx` (Services variant) — wire into the Services issue
   view + deep-link to Agents.
7. Amend `2026-07-13-issue-container-and-pr-pipeline.md` §4.5/§5 with the
   gate/Critic split + write `critic.ts` contract + fixtures (live model call
   deferred to the connector session).

Out of scope (explicitly): the live Claude Critic API call, the Sentry
connector, `@arete/db` schema, the replay affordance, rich per-finding triage.
