# Issue Container & PR Pipeline — design spec

**Status:** design · 2026-07-13 · branch `feat/marble-ink-foundation`
**Drives:** the Services + Agents right-hand panels, and the backend that
feeds them. UI mockups already approved: Synthesizer thinking console
(artifact `8ee4f4d7`), triage inbox (`134a9353`).

## 1. Core model — one Issue Container, two doors, two gates

An **Issue Container** is the single source of truth for one problem, from
detection to merged PR. Both the Services page and the Agents page are
*projections* of the same container — they never hold independent state.

- **Services page = big picture / the *what*.** Enter issue-first. Shows the
  overall scope + the **formatted, human-facing PR**, and is where the human
  **Posts the PR** or **Requests changes** (the send gate).
- **Agents page = detailed / the *how*.** Deep-linked from a Services issue,
  focused on that container. Shows the agents working + the Synthesizer
  composing the PR *in code*, and is where the human **Approves the solution**
  (the technical sign-off).

Two-stage human gate, enforced **server-side** (not just UI):
`solutionApprovedAt` must be set (Agents) **before** a post action (Services)
can run. Nothing reaches a real repo without both.

## 2. Right-panel contract (what each panel renders)

| | Agents right panel — "Solution" | Services right panel — "Pull request" |
|---|---|---|
| Framing | the PR being composed in code | the formatted PR ready to send |
| Content | verified findings -> review comments; per-agent provenance; files touched; the diff | **target repository** + `base <- branch`; PR title + body; comments rendered as they'll appear; verified/dropped counts |
| Repo/target context | NOT here | **here** — repository selector + base/branch live on Services |
| Primary action | **Approve solution** | **Post PR** |
| Secondary | (re-run / request re-verify) | **Request changes** · Copy patch |
| Never | posts to the repo | re-derives findings — it renders what Agents composed |
| State chip | shared PR state (drafting -> composing -> ready -> …) | same shared PR state, in lockstep |

Both read `container.pr`; the chip is identical on both pages at all times.

**Repository / target context lives on Services only.** Which repo the PR
targets and its `base <- branch` are part of *where the PR is sent* — so the
repository selector belongs on the Services PR panel, not the Agents
composition panel. (Today's `pr-panel.tsx` has a disabled repo selector on the
Agents side; the refactor moves it to Services.)

## 3. Data model

```ts
type ContainerState =
  | "detecting" | "fanning_out" | "verifying" | "composing"
  | "ready" | "solution_approved" | "posted" | "changes_requested" | "merged"
  | "dismissed";

interface IssueContainer {
  id: string;                 // stable container id (deep-linkable route param)
  installationId: string;     // tenancy scope — every query filters on this
  serviceId: string;
  fingerprint: string;        // dedupe key (see §4) — unique per (installation, fingerprint)
  source: string;             // Sentry | Vercel | Stripe | CI | PostHog | Areté
  severity: "critical" | "high" | "medium";
  state: ContainerState;
  firstSeen: Date; lastSeen: Date; occurrences: number;
  evidence: EvidenceRow[];    // raw normalized telemetry that flagged it
  findings: Finding[];        // candidates + verdicts (provenance below)
  transcript: SynthStep[];    // the Synthesizer "thinking" — append-only, ordered
  pr: PullRequest | null;
  gates: { solutionApprovedAt: Date | null; solutionApprovedBy: string | null;
           postedAt: Date | null; postedBy: string | null };
  createdAt: Date; updatedAt: Date;
}

interface Finding {
  id: string;
  agentId: string;            // provenance: which specialist raised it
  category: string;           // == agent_name from packages/agents/*.py
  file: string; line: number; // WHERE — must reference the diff for "kept"
  rationale: string;
  diff: DiffRow[];
  verdict: "candidate" | "kept" | "dropped";
  droppedReason?: string;     // required iff verdict === "dropped"
  evidenceRef?: string;       // link back to an EvidenceRow / telemetry id
  confidence?: number;
}

interface SynthStep {         // one line of the verification transcript
  kind: "dispatch" | "report" | "verify" | "keep" | "drop" | "compose" | "posted";
  findingId?: string; agentId?: string;
  text: string; detail?: string; at: Date;
}

interface PullRequest {
  number: number | null;      // null until actually opened on the host
  base: string; branch: string;
  title: string; body: string;
  comments: Array<{ findingId: string; file: string; line: number; body: string }>;
  state: "drafting" | "composing" | "ready" | "posted" | "changes_requested" | "merged";
  hostUrl: string | null;
}
```

Invariant: `pr.comments[i].findingId` always resolves to a `Finding` whose
`verdict === "kept"`. A comment can never exist without a kept finding, and a
kept finding can never exist without a real `file:line` in the diff.

## 4. Pipeline (ingestion -> post), stage by stage

1. **Ingest.** Per-connector adapters (webhooks where available, polling
   otherwise) receive raw events + GitHub/GitLab PR events. Each adapter is a
   pure `normalize(rawEvent) -> NormalizedEvent`. **Idempotent:** dedupe on the
   provider's own event id (`(provider, providerEventId)` unique) so replays
   are no-ops.
2. **Compile + dedupe per service.** Group normalized events into issues by a
   deterministic **fingerprint** (error type + normalized stack frame + service,
   Sentry-style). Same fingerprint -> same container; bump `occurrences` /
   `lastSeen` instead of creating a duplicate.
3. **Container create/attach.** New fingerprint -> new `IssueContainer`
   (`state: detecting`). Deep-linkable by `id`.
4. **Agent fan-out** (`state: fanning_out`). The 6 specialists each analyze the
   change and emit candidate `Finding`s tagged with `agentId` + `evidenceRef`.
   No verdict yet.
5. **Synthesizer verification** (`state: verifying`). **Two stages, and the
   order is the guarantee** (refined in
   `2026-07-13-synthesizer-component-and-critic.md` §1; implemented in
   `lib/issue-pipeline/critic.ts` `verifyHybrid`):
   - **① Deterministic gate** — `kept`-eligible iff its `file:line` is in the
     changed lines. A **pure function** of `(candidates, diff)`: deterministic,
     replayable, testable. A gate-failed candidate is `dropped` with a
     `droppedReason` and never reaches the model.
   - **② LLM Critic** — a separate model reasons about each *gate-passed*
     finding and may only **uphold, drop, or flag** it (low confidence →
     `needsAttention`). It is never consulted about a gate-failed finding, so
     the containment law **`kept ⊆ gatePassed ⊆ candidates`** holds
     structurally. Fails open (a Critic outage keeps the gate-proven finding and
     flags it — never a silent drop, never a fabrication).
   Both stages emit ordered `SynthStep`s (this *is* the transcript the thinking
   console renders).
6. **PR compose** (`state: composing -> ready`). Kept findings -> review
   `comments`; assemble `title`/`body`. This is what the **Agents** panel shows.
7. **Gate 1 — approve solution** (Agents). Human sign-off -> set
   `gates.solutionApprovedAt`, `state: solution_approved`.
8. **Gate 2 — post / request changes** (Services). Only reachable when
   `solutionApprovedAt != null`. **Post PR** -> call the host API (idempotency
   key = container id) -> `state: posted`, `pr.number` filled. **Request
   changes** -> `state: changes_requested` (loops back to fan-out with the note).
9. **Merge** tracked from host webhooks -> `state: merged`.

## 5. Structural integrity · SWE principles · QA

- **Single source of truth.** The container row is authoritative; both pages
  are read projections; PR state is one field, synchronized (DB + realtime
  channel). Two panels can never disagree.
- **Provenance / auditability.** Every posted comment -> kept finding -> agent
  -> evidence ref -> diff line. Fully traceable end to end.
- **Idempotency everywhere.** Ingestion (provider event id), verification
  (pure fn), posting (container-id idempotency key so a double-click or retry
  never opens two PRs).
- **No fabrication (aletheia).** Enforced as an invariant, not a convention: a
  `kept` finding *must* reference a diff line; empty states are empty; the UI
  never invents counts/states.
- **Explicit state machine.** Transitions in §4 are the only legal ones;
  illegal transitions are rejected server-side. Human gates are enforced in the
  backend, not merely hidden in the UI.
- **Tenancy.** Every read/write filters on `installationId` (existing
  convention); not-found and not-authorized return uniformly.
- **QA / tests (must exist before wiring a connector live):**
  - normalization + fingerprint/dedup unit tests per connector adapter
    (contract tests against recorded fixtures);
  - verification fixtures: given candidates + a diff, assert exactly which are
    kept/dropped — including the **"no evidence in diff => dropped"** invariant;
  - state-machine transition tests (every illegal transition rejected);
  - idempotency tests (replay the same webhook => one container; double Post =>
    one PR);
  - the "comment => kept finding => real file:line" invariant as a property test;
  - tenancy-scoping tests (no cross-installation leakage).

## 6. Build order (do in a clean session)

1. Types + the `IssueContainer` model in `@arete/db` (schema) — coordinate,
   schema changes are single-owner.
2. In-memory/sample provider first (the SAMPLE_ISSUES already in
   `services-workspace.tsx` become fixtures against this shape).
3. Right-panel UI split to the §2 contract (Agents = Solution/approve;
   Services = formatted PR/post) — the code change deferred from this session
   because `pr-panel.tsx`/auth are being actively edited by a parallel agent.
4. One real connector end-to-end (Sentry) through the whole §4 pipeline.
5. Realtime sync + the deep-link handoff (Services issue -> focused Agents
   container).
