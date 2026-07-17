# Kuma — Localhost Fully-Functional & Testable: Audit + Dispatch (2026-07-16)

**Goal (user):** do a full review of everything — what's wired in the background vs
what the frontend still needs — and get the stack **fully functional and testable by
the user on the localhost we're running now.** Dispatch the remaining backend/agents
work to Engineers 1 and 3 (Eng2 is loaded on the Fix-workflow gate, item ③).

This is a status snapshot against the Wave-2 gap map (`2026-07-16-wave-2-full-integration.md`)
plus a focused push on the ONE spine that makes localhost genuinely testable.

---

## 1. The localhost user journey today — screen by screen (verified 2026-07-16)

| Screen | State | Reality |
|---|---|---|
| `/overview` onboarding card | LIVE | Persists + evolves to "Review findings". |
| `/overview` code map | LIVE | Real 11-node graph of `beancount-sandbox`, keyless via CLI mode. |
| `/overview` telemetry | seeded / CTA | Connect-CTA badge for detected-not-connected (Eng2 `767bf92`); no real ingestion. |
| `/connections` | partial | Connected badge + repo. **No "AI Models" section — the enabler is absent.** |
| `/services` triage inbox | LIVE | Real PRs of the connected repo; selecting streams a real Synth transcript. |
| `/services` Fix → approve → Send PR | in flight | Live driver + live SSE exist on `feat/wave2-fix-ui` (Eng2 ②); gate UI + Send PR in flight (③). |
| `/agents` reviews | SEEDED | The review data is **seeded, not produced by a live review.** This is the gap. |

**The single honest gap that blocks a testable end-to-end demo:** a localhost user
cannot run a *real* review, because the review pipeline needs a model and there is no
way to connect one. Fix that and `/agents` + `/overview` go from seeded to live.

## 2. What's wired in the background (verified)

- **Code map** builds on connect (webhook→agents index) and loads keyless via CLI mode.
- **Services inbox** reads the tenant's real PRs; SSE streams real Synth steps.
- **Fix-workflow engine** (Eng2, on `feat/wave2-fix-ui`): `driveContainer` advances a
  container `detecting → … → ready` from a real DispatchPlan; SSE streams it live
  (`28ce21c`); ⚑ human-look flag is engine-generated off the real critic threshold.
- **Staging seam** `POST /staging/send` (Eng1 `a13a2b9`) with `loadApprovedContainer`
  inert pending the persistent store.
- **Approval-exec worker** consolidated (Eng1, `feat/approval-exec-worker` @ 294/294).
- **Gemini provider** wired into the review path (Eng3).
- Prior waves: auth, GitHub App install→tenant, outbound webhooks (P1.1), Sensorium v1
  (both on `integration`), Glass Box cockpit, connector catalog.

## 3. Confirmed-missing (the frontend + wiring gaps)

- **`ModelConnection` — does NOT exist** in `packages/db/prisma/schema.prisma` (only
  `TelemetryConnection`). → no per-tenant model config anywhere.
- **`IssueContainer` — does NOT exist** in the schema → `loadApprovedContainer` has no store.
- **No AI Models UI** in the dashboard (no component, no `/api/model-connections` ref).
- **No `/api/model-connections`** route in webhook (no resolve/decrypt seam).
- **Agents `/review` is single-global-env** (`llm/base.py`: `get_llm` switches
  anthropic|gemini from process `Settings`; `get_llms_by_role` is **Anthropic-only**,
  critics hardwired opus/sonnet). No per-request config, no Ollama.

## 4. The spine — AI Models connect (Ollama free default) → real reviews on

This is workstreams **I + A** from the Wave-2 plan, and it is THE unlock for a testable
localhost. On localhost the user's Ollama at `http://localhost:11434` is reachable, so
the free companion-tier default works with **zero cloud keys** — the perfect dogfood:
connect local Ollama → drive a real review on `beancount-sandbox` → live findings replace
the seed on `/agents` and `/overview`.

**Critic-stage ruling (new):** the critic verification stage is hardwired to Anthropic
opus/sonnet. For a zero-cloud-key localhost run that path is unavailable. **Ruling:** when
the tenant's connection is non-Anthropic (e.g. Ollama), the critics **run on the tenant's
connected model** — the review stays functional and free, losing only the two-tier
independent-escalation guarantee. The UI states this honestly ("verification runs on your
connected model"); we never silently claim an Anthropic critic ran, and never fabricate.
The platform-default Anthropic key (if present) is still preferred for critics when available.

## 5. Dispatch — Eng1 + Eng3 (backend/agents); PM owns the frontend; Eng2 continues ③

### Engineer 1 — db + webhook (the two foundations; do in this order)
1. **`ModelConnection` model + migration** (sole schema writer): `installationId`,
   `provider`, `apiKeyEncrypted?` (nullable for Ollama), `model`, `baseUrl?`, timestamps;
   `@@unique([installationId, provider])`; encrypted via the existing `TELEMETRY_ENCRYPTION_KEY`
   scheme; tenant-scoped like `TelemetryConnection`.
2. **`/api/model-connections` CRUD + Test** (tenant-scoped): list/create/delete + a cheap
   **Test** ping (never persists a bad key). This is what the frontend AI Models UI calls.
3. **Review-job model resolve/decrypt** (webhook): resolve the tenant's `ModelConnection`,
   decrypt in-memory only, pass `{provider, model, apiKey, baseUrl}` to agents `/review`.
   No connection → pass the Ollama companion default; never a raw `.env` key path.
4. **`IssueContainer` model + migration** (the deferred persistence foundation):
   `installationId`, `state`, `gates` (incl. `solutionApprovedAt`), `target`, `findings`.
   `loadApprovedContainer` becomes the scoped, gate-enforced read
   (`id AND installationId=<caller> AND gates.solutionApprovedAt NOT NULL` → else **404**);
   land the `not_found` outcome with it. Write side is the dashboard/driver contract.

### Engineer 3 — agents (Python)
1. **`/review` accepts per-request `{provider, model, apiKey, baseUrl}`** and builds the
   client from the passed config, not global `Settings`. `get_settings()` stays only as the
   platform-default fallback.
2. **Add the Ollama provider** (`langchain_ollama` ChatOllama at `baseUrl`) and
   **generalize `get_llms_by_role`** beyond Anthropic opus/sonnet to a `{provider, model}`
   per role. Apply the §4 critic ruling (critics on the tenant model when non-Anthropic).
3. **Ollama-default fallback + honest empty state**: no connection on companion tier →
   default `http://localhost:11434` + a code model (recommend `qwen2.5-coder`); if Ollama
   isn't running / no model pulled → honest empty state with `ollama pull qwen2.5-coder`,
   **never a fabricated review**. SaaS tier (localhost unreachable) → say so, route to connect.
4. **(Already queued) context-map `tools.py` rewire** (cherry-pick `7fffdfe` → item 3) —
   sequence after the review-model work if it competes; it's independent and de-risked.

### PM (me) — frontend
- **Build the "AI Models" Connections section** on `/connections`: provider cards
  (Anthropic / OpenAI / Gemini / OpenRouter / Local·Ollama), connect flow (key or Ollama
  base URL) → model select → **Test** → Connected badge + which model. Wire to Eng1's
  `/api/model-connections` CRUD/Test. Ollama shown as the free default; no "infinite" claim.
- Reconcile the Fix-workflow UI (Eng2's `feat/wave2-fix-ui`) into the frontend at integration.

### Engineer 2 — unchanged: finish ③ (server-enforced approval gate + typed StagingClient
seam to the real `POST /staging/send` contract), then checkpoint. No Send-PR end-to-end
until Eng1's endpoint + `IssueContainer` store land at integration.

## 6. The testable milestone (definition of done for this push)

On the running localhost, with **no cloud keys**:
1. User opens `/connections` → **AI Models** → connects **Local · Ollama** → Test passes.
2. A review of `beancount-sandbox` runs on that model end-to-end (companion tier).
3. **Live** findings appear on `/agents` + `/overview` — the seed is guarded, so live and
   seeded data never mix in the tenant.
4. From `/services`, Fix → live Synth stream → human approves (`ready → solution_approved`,
   server-enforced) → staged PR view. (Send PR stays gated until integration.)

## 7. Invariants (unchanged, every task)

Tenancy scoping by `installationId`; HITL moat (no auto-send / no auto-merge); anti-fabrication
(no invented findings/diffs — honest empty states); secrets encrypted at rest, never logged,
decrypted in-memory only; keys out of git. A missing/failed model → honest empty, never a
fabricated review.
