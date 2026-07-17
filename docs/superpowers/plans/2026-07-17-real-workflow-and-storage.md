# Real End-to-End Workflow + Cost-Effective Storage (2026-07-17)

**Two questions from the user + one serious integration concern:**
1. Where is each user's data stored today, and how do we scale to ~50 users cheaply (free, tight budget)?
2. The dashboard shows data that looks *already pushed through the workflow* — synthetic. We want the
   opposite: start empty → connect services → **Services page lists real problems** → user **selects**
   which to fix → agent pipeline runs the strategies → each agent verifies → synthesizer stages the
   solution → **PR sent**. Right now we "just see a bunch of data on pages." Make the real workflow work,
   from a clean starting point, cheaply.

---

## Part A — Where your data lives today (answer to Q1)

**One PostgreSQL database (`arete`), every row scoped by `installationId` (the tenant).** There is no
per-user database; multi-tenancy is enforced by scoping every query to the caller's installation(s).

| Data | Table | Notes |
|---|---|---|
| The tenant | `Installation` | owner, plan, externalId |
| Identity | `User`, `Account` | Google/GitHub login; `Account` holds the encrypted GitHub token |
| Connected repos | `Repository` | one per connected repo |
| Reviews the AI ran | `Review`, `ReviewComment` | the findings — text, kilobytes each |
| Connected model | `ModelConnection` | **API key AES-256-GCM encrypted at rest** |
| Telemetry connectors | `TelemetryConnection` | PostHog/Sentry/Vercel creds, encrypted |
| Fix workflow state | `IssueContainer` | the state machine — **currently 0 rows, not yet persisted** |
| Agent memory / approvals | `AgentMemory`, `ApprovalPrompt` | the HITL record |

**One thing lives outside Postgres:** the **code map** (the code-graph the agents navigate) is built from a
cloned repo and stored as a codebase-memory session on disk, per installation. That's the only component
whose footprint grows with repo size rather than review count.

## Part B — Scaling to 50 users, for ~$0 (answer to Q1, cont.)

**50 tenants is tiny.** Review data is text (findings + comments), kilobytes per review. 50 users × hundreds
of reviews each is still low **megabytes** of Postgres. The scaling concern is not the database — it's
inference cost, and the architecture already solves that.

**The key cost insight: you don't pay for the AI.** The BYO-model design (Anthropic/OpenAI/Gemini/
OpenRouter/**free local Ollama**) means every review runs on the *user's* model and key. The expensive part
of an AI product — LLM inference — is offloaded to the tenant by design. Your marginal cost per user is
essentially **zero**.

**Recommended free storage: [Neon](https://neon.tech) serverless Postgres (free tier).**
- 0.5 GB free — ample for hundreds of tenants of review text.
- **Scales to zero** when idle — no charge for an app that isn't under constant load (perfect for tight budget).
- Drop-in: it's Postgres, so the existing Prisma schema and `DATABASE_URL` move over with **no code change**.
- Alternative: Supabase free tier (500 MB, also Postgres; the repo already references Supabase practices).
  Neon wins on scale-to-zero for a cost-sensitive, low-traffic start.

**The disk-bound code map** is the only thing to bound: for 50 repos, cache the **graph export (JSON)** and
drop the working clone after indexing, or evict least-recently-used clones. Not urgent at 50; note it so it
doesn't surprise us at 500.

**Net:** single free Neon Postgres + BYO-model inference + the three services on one small/free host
(Fly.io/Render free dynos) runs 50 users at effectively no infrastructure cost.

---

## Part C — Why it looks "synthetic / already pushed through" (root cause of Q2)

The pages themselves are **honest** — overview, agents, and services all read real Prisma data scoped to the
tenant, with real empty-states. Three concrete things create the false impression:

1. **Old test-harness data.** The DB holds **3 real `Review` rows + 9 `ReviewComment` rows** left over from
   Eng3's E2E sandbox harness. They're real, but stale — so the Services inbox shows completed reviews on a
   repo you didn't just review, making it look pre-populated.
2. **The Fix/Synthesizer stream is fed by a SAMPLE container.** `live-drive.ts` exposes
   `getLiveSampleContainer()` — a container that `driveContainer` has **already advanced to `ready`/
   `fanning_out`**. Because `IssueContainer` persistence isn't wired yet (0 rows), the SSE route streams this
   pre-driven sample transcript. So when you open a Fix, you see a workflow that already ran — *exactly* the
   "areas already pushed through" symptom.
3. **There is no user-selection trigger.** Today a review runs automatically on PR-open; the Fix workflow is
   not born from a problem you chose. The mental model you want — *pick a problem → run the pipeline* — isn't
   wired; the pipeline exists (the state machine) but nothing starts a **real** container from a selection.

## Part D — The workflow we want (made concrete)

```
connect repo + model
   → Services lists REAL problems (findings from real reviews, grouped)
   → user SELECTS the problems to fix
   → for each: create a real IssueContainer, drive it:
        detecting → fanning_out (specialists propose) → verifying (each agent
        verifies its own) → composing (synthesizer reconciles + stages) → ready
   → human APPROVES (the moat)
   → StagingClient sends the staged PR  → posted
```

Every stage streams live in the Glass Box; nothing is pre-driven; a fresh tenant starts **empty**.

## Part E — The plan (phased, grounded in what's already dispatched)

### Phase 0 — Clean starting point (fast; PM + Eng2)
- **Purge the harness data** from the dev DB (3 reviews, 9 comments, keep the Installation + Repository +
  identity). One-time SQL, reversible via a dump first. *PM executes on user go.*
- **Remove the sample-container interim source** as the SSE feed: once Phase 1 lands, `getLiveSampleContainer`
  stops being the live source; the sample stays ONLY behind the marketing `variant="framed"` preview, never a
  real tenant. Guard: a connected tenant never sees `SAMPLE_*` or a driven sample.
- **Definition of done:** a freshly connected tenant with no PRs sees honest empty states everywhere —
  "connect a service", "no problems yet", "no pull request yet".

### Phase 1 — Persist the workflow (Eng2 Part A — already dispatched)
- Driver creates an `IssueContainer` row (scoped) on start; updates `state`/`gates` on each transition.
- `/api/containers/[id]/approve` sets `solutionApprovedAt` in the DB against stored state (keep 409-if-not-ready).
- **SSE reads the real persisted container**, not `getLiveSampleContainer`.
- **DoD:** a driven container survives a refresh; `loadApprovedContainer` returns a real row.

### Phase 2 — User selects the problem (the reframe — new work, Eng2)
- Services page: each finding/problem is **selectable**; a "Fix selected" action **creates and drives a real
  container** for that problem (the trigger the model is missing today).
- The container is born from the chosen finding — real target, real repo, real diff context.
- **DoD:** selecting a problem on Services starts a live review you watch from `detecting` → `ready`.

### Phase 3 — Verify → synthesize → send (Eng2 Part B + Eng3)
- Each specialist verifies its own candidate (critic pass); synthesizer composes + **stages** the PR.
- StagingClient → webhook `POST /staging/send` with the honest 200/409/404/502/400 mapping.
- **DoD:** approve → Send PR opens a real PR on the connected repo; logout/login persists it.

### Phase 4 — Move storage to free Neon (PM, when multi-user)
- Create a Neon free project; point `DATABASE_URL` at it; `prisma migrate deploy`. No schema change.
- Keep the encryption key + secrets in the host's env, never in git.
- **DoD:** the app runs identically on Neon; scales to zero when idle.

## Invariants (unchanged, every phase)
Tenancy scoped by `installationId`; HITL moat (no auto-send/merge; only a human crosses `ready`);
anti-fabrication (honest empty states, real confidence only); secrets encrypted at rest, never logged;
BYO-model keeps inference cost on the tenant.
