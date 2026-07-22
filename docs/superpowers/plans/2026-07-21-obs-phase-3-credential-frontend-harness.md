# Observability Phase 3 — Credential Integrity, Frontend Consumption, Harness Efficiency

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the one unmet Phase 2 DoD gate (internal tokens have no expiry) by moving service-to-service auth to signed short-lived tokens; make the MCP OAuth flow tell the truth; let the dashboard consume the healing data Phase 2 produced; and remove three inspectable inefficiencies in the review/fix harness.

**Architecture:** Internal calls between our own processes (webhook ↔ agents ↔ dashboard) carry an HS256 JWT minted per request with `iat`/`exp`/`kid`, verified for expiry and key-id on arrival. A shared TS package (`@arete/internal-token`) is the single source for mint+verify on the Node side; the Python service mirrors the exact wire format via PyJWT, pinned by a checked-in cross-language test vector. The one hop we do **not** originate — Alertmanager → webhook `/alerts/incoming` — keeps a dedicated **static** credential, because Alertmanager can only present a fixed string from a file and cannot mint a signed token. Frontend and harness work sit on top of unchanged interfaces.

**Tech Stack:** TypeScript (`jose` for HS256), Python (`PyJWT`), Prisma/PostgreSQL, Next.js App Router (dashboard), FastAPI + LangGraph (agents), BullMQ (webhook), OpenTelemetry.

---

## Scope decisions (spec-vs-reality, recorded like Phase 2)

| Decision | Why |
|---|---|
| Signed tokens cover our own hops only; `/alerts/incoming` keeps a **separate static** `ALERTMANAGER_INGEST_TOKEN`. | Alertmanager presents a fixed `credentials_file` string; it cannot mint a signed token. Splitting the third-party machine credential from our internal minting is cleaner than forcing one scheme onto both. |
| Clean cutover, **no dual-accept** of the legacy static `INTERNAL_API_TOKEN` on internal routes. | All four processes deploy from one repo/compose in lockstep, so a flag day is safe. Dual-accepting the old opaque secret would keep expiry inexpressible and make the DoD mutation test (clock at 2036 → 401) impossible to pass. |
| MCP fix does a real `authorization_code`→token exchange against a **configured** `token_url`; it does **not** implement RFC 8414 discovery or dynamic client registration. | Discovery/DCR are a separate feature. The honesty defect — fabricating a token and claiming success — is closed by a real exchange plus fail-closed behaviour when unconfigured. |
| Frontend scope is **incremental**: incident *detail* view + cooldown surfacing. The incident *list* already shipped in Phase 2. | `lib/incidents.ts` + `components/dashboard/incidents/incident-list.tsx` already read `Incident` rows on the Overview page. Greenfield list work would be rebuilding shipped code. |
| Harness scope is the three **inspectable** fixes. The "is haiku good enough to *author* fixes?" question is **deferred**, documented in the backlog. | Answering it needs a real Anthropic key and a regression corpus (see Phase 2 retrospective). Changing the tier blind risks a silent quality regression. |

## Precedence (carried forward from Phase 2, unchanged)

Where this plan's conventions collide with an existing pattern elsewhere in the repo, **this line of work wins** — it derives from the SUPERLOG source spec. Two carve-outs, also unchanged: do not delete working behaviour another feature consumes, and do not relax any security/tenancy/HITL constraint. Phase 3 *tightens* the security constraint (expiry), so the carve-out and the goal point the same way.

## Global Constraints

Every task's requirements implicitly include this section. Exact values are binding.

1. **Metric cardinality (frozen, spec §4/§5).** Metric dimensions stay closed low-cardinality sets (role, outcome, provider, model). Tenant ids, repo names, PR numbers, SHAs, token `kid`s, incident ids → span attributes only, **never** metric dimensions.
2. **Redaction (frozen, spec §5).** Any new sink text goes through the canonical `@arete/telemetry` scrubber (`scrubSinkText`) / Python `censor_processor`. Never a bespoke scrubber. Tokens and signing keys must never be logged — extend the blocklist and its test if a new field could carry one.
3. **Fail-closed auth.** Every guard answers 503 when its credential/keyset is unconfigured and 401 on a bad presentation. Never run open. This holds for the signed-token verifier, the Alertmanager static guard, and the MCP exchange.
4. **Tenant scoping.** Every new dashboard query is scoped by `installationId`/`repositoryId` `in` the session's resolved installations — the exact pattern `lib/queries.ts` already uses. A row from another installation must be indistinguishable from a row that does not exist.
5. **Constant-time comparison.** Any remaining opaque-secret compare (the Alertmanager static token) uses `timingSafeEqual` / `hmac.compare_digest`. Signature verification uses the library's own verify, never a hand-rolled HMAC compare.
6. **Signed-token wire format is ONE format across two languages.** Header `{alg:"HS256", typ:"JWT", kid:<string>}`; claims `{iss:<"arete-webhook"|"arete-dashboard"|"arete-agents">, aud:"arete-internal", iat:<int seconds>, exp:<int seconds>}`. TTL is `INTERNAL_TOKEN_TTL_SECONDS`, default **120**. Verify requires: `aud=="arete-internal"`, `exp` in the future (leeway ≤ 5s), `kid` present in the active keyset, signature valid. The TS package and the Python module both assert the checked-in test vector in `docs/superpowers/fixtures/internal-token-vector.json` (fixed key + fixed iat/exp → fixed compact JWT string); a change to either side that breaks the shared vector fails a test.
7. **Keyset & rotation.** Signing keys live in `INTERNAL_TOKEN_SIGNING_KEYS` (JSON object `{ "<kid>": "<secret>", ... }`, one or two entries) and the mint key id in `INTERNAL_TOKEN_ACTIVE_KID`. Mint signs with `KEYS[ACTIVE_KID]`. Verify accepts any `kid` present in `KEYS`. **Rotation:** add the new kid to `KEYS`, deploy, flip `ACTIVE_KID`, deploy, drop the old kid after one TTL. **Revocation:** remove a kid from `KEYS`. Empty/unparseable `KEYS` → 503.
8. **Turn/model discipline.** Dispatch the cheapest model that fits each task (writing-plans/subagent-driven guidance). Security-critical tasks (1–6, and Task 7's scoped query) get full independent review with mutation tests observed failing; the rest get spot-checks. Reviews are scoped to security-critical chunks (the phase's chosen rigor).
9. **Duplication is single-sourced or drift-guarded.** The TS mint/verify has exactly one home (`@arete/internal-token`). The Python mirror and any unavoidable duplicate (e.g. dashboard's existing `fix-cooldown.ts` mirror) carry a drift-guard test pinning the shared contract, mirroring the Phase 2 cooldown pins.
10. **Honest failure.** No path fabricates success. The MCP exchange, like the Phase 2 memory write, returns/stores a real outcome or an honest error — never a plausible-looking placeholder presented as done.

---

# THEME 1 — Credential integrity

### Task 1: `@arete/internal-token` shared package — mint + verify

**Files:**
- Create: `packages/internal-token/package.json`, `packages/internal-token/tsconfig.json`, `packages/internal-token/src/index.ts`
- Create: `packages/internal-token/src/keyset.ts` (env parsing), `packages/internal-token/src/mint.ts`, `packages/internal-token/src/verify.ts`
- Create fixture: `docs/superpowers/fixtures/internal-token-vector.json`
- Test: `packages/internal-token/src/mint.test.ts`, `verify.test.ts`, `vector.test.ts`

**Interfaces:**
- Consumes: env (`INTERNAL_TOKEN_SIGNING_KEYS`, `INTERNAL_TOKEN_ACTIVE_KID`, `INTERNAL_TOKEN_TTL_SECONDS`), `jose`.
- Produces:
  - `mintInternalToken(iss: 'arete-webhook' | 'arete-dashboard' | 'arete-agents', opts?: { now?: number }): Promise<string>` — a compact HS256 JWT per Global Constraint 6. Throws `InternalTokenNotConfigured` if the keyset/active kid is missing (callers translate to their own posture).
  - `verifyInternalToken(authorizationHeader: string | undefined, opts?: { now?: number }): Promise<VerifyResult>` where `VerifyResult = { ok: true; iss: string; kid: string } | { ok: false; reason: 'no_header' | 'malformed' | 'unknown_kid' | 'bad_signature' | 'expired' | 'wrong_audience' }`. **Never throws** on a bad token — bad input is a result, not an exception. Throws only `InternalTokenNotConfigured` when the *keyset itself* is unconfigured (so the caller can answer 503, not 401).
  - `loadKeyset(): { keys: Record<string,string>; activeKid: string } | null` — `null` when unconfigured.
  - `INTERNAL_TOKEN_DEFAULT_TTL_SECONDS = 120`.
  - `now?` is injectable seconds-since-epoch so tests can set the clock (this is how the expiry mutation test works). Default reads the real clock.

**Design notes for the implementer:**
- Use `jose` (`SignJWT`, `jwtVerify`). Set the protected header `kid`. Set `aud: 'arete-internal'`, `iss`, `iat`, `exp = iat + ttl`.
- `verifyInternalToken` parses the header to read `kid` *before* verifying, selects `keys[kid]`, and if absent returns `{ ok:false, reason:'unknown_kid' }` (this is revocation). Then `jwtVerify(token, secret, { audience: 'arete-internal', clockTolerance: 5, currentDate: new Date(now*1000) })`. Map jose's expiry error to `reason:'expired'`, signature error to `bad_signature`, audience error to `wrong_audience`.
- The keyset parser rejects an empty object and an `activeKid` not present in `keys` by returning `null` (→ callers 503).

- [ ] **Step 1: Failing test — round-trip and each verify reason**

```ts
// verify.test.ts (excerpt)
const KEYS = JSON.stringify({ k1: 'a'.repeat(48) })
beforeEach(() => { process.env.INTERNAL_TOKEN_SIGNING_KEYS = KEYS; process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k1' })

it('mints and verifies a fresh token', async () => {
  const t = await mintInternalToken('arete-webhook')
  const r = await verifyInternalToken(`Bearer ${t}`)
  expect(r).toEqual({ ok: true, iss: 'arete-webhook', kid: 'k1' })
})

it('rejects an expired token (the DoD gate — clock in the future)', async () => {
  const t = await mintInternalToken('arete-webhook', { now: 1_700_000_000 })
  // 10 years later, well past the 120s TTL
  const r = await verifyInternalToken(`Bearer ${t}`, { now: 1_700_000_000 + 315_360_000 })
  expect(r).toEqual({ ok: false, reason: 'expired' })
})

it('rejects a token whose kid was revoked (removed from the keyset)', async () => {
  const t = await mintInternalToken('arete-webhook')
  process.env.INTERNAL_TOKEN_SIGNING_KEYS = JSON.stringify({ k2: 'b'.repeat(48) })
  process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k2'
  expect(await verifyInternalToken(`Bearer ${t}`)).toEqual({ ok: false, reason: 'unknown_kid' })
})

it('accepts a token signed by a non-active kid still present (rotation window)', async () => {
  const t = await mintInternalToken('arete-webhook') // signed k1
  process.env.INTERNAL_TOKEN_SIGNING_KEYS = JSON.stringify({ k1: 'a'.repeat(48), k2: 'b'.repeat(48) })
  process.env.INTERNAL_TOKEN_ACTIVE_KID = 'k2' // now minting k2, but k1 still valid
  expect(await verifyInternalToken(`Bearer ${t}`)).toMatchObject({ ok: true, kid: 'k1' })
})

it('rejects a tampered signature', async () => {
  const t = await mintInternalToken('arete-webhook')
  const bad = t.slice(0, -2) + (t.endsWith('aa') ? 'bb' : 'aa')
  expect(await verifyInternalToken(`Bearer ${bad}`)).toEqual({ ok: false, reason: 'bad_signature' })
})

it('answers unconfigured distinctly from unauthorized', async () => {
  delete process.env.INTERNAL_TOKEN_SIGNING_KEYS
  await expect(verifyInternalToken('Bearer x')).rejects.toBeInstanceOf(InternalTokenNotConfigured)
})
```

- [ ] **Step 2: Run — expect FAIL** (`pnpm --filter @arete/internal-token test`, module not found).
- [ ] **Step 3: Implement** `keyset.ts`, `mint.ts`, `verify.ts`, `index.ts` to the interface above.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Cross-language test vector.** Generate one token with a fixed key `{"vec":"0123456789abcdef0123456789abcdef"}`, `iss:'arete-webhook'`, `iat:1_700_000_000`, `exp:1_700_000_120`, write the resulting compact JWT string into `docs/superpowers/fixtures/internal-token-vector.json` alongside those inputs. Add `vector.test.ts` asserting `mintInternalToken(... fixed inputs ...)` reproduces that exact string, and that `verifyInternalToken` accepts it at `now:1_700_000_100` and reports `expired` at `now:1_700_000_200`.
- [ ] **Step 6: Wire the workspace** (add `@arete/internal-token` to the pnpm workspace build; add `jose` to its deps). Run the repo typecheck/build to confirm the new package compiles.
- [ ] **Step 7: Commit** — `git add packages/internal-token docs/superpowers/fixtures/internal-token-vector.json pnpm-lock.yaml` (+ workspace config), `feat(internal-token): signed short-lived internal tokens (HS256, exp/kid rotation)`.

**Review:** security-critical. Reviewer runs the mutation set: confirm the expired, unknown_kid, and bad_signature cases each fail *before* the fix logic exists (revert verify body → tests red), and that the 503-vs-401 distinction is preserved.

---

### Task 2: Wire the webhook to signed tokens; split off the Alertmanager static guard

**Files:**
- Modify: `packages/webhook/src/internal-auth.ts` (mint + verify via the package)
- Create: `packages/webhook/src/alertmanager-auth.ts` (static guard for `/alerts/incoming`)
- Modify: `packages/webhook/src/server.ts` (route `/alerts/incoming` to the static guard; all other internal routes to the signed verifier)
- Modify/replace tests: `packages/webhook/src/internal-auth.test.ts`, add `alertmanager-auth.test.ts`
- Add dep: `@arete/internal-token` to `packages/webhook/package.json`

**Interfaces:**
- Consumes: `mintInternalToken`, `verifyInternalToken`, `InternalTokenNotConfigured` from `@arete/internal-token`.
- Produces (unchanged names so call sites don't move):
  - `internalAuthHeaders(): Promise<Record<string,string>>` — now async; mints `iss:'arete-webhook'`; returns `{}` when unconfigured (caller-side stays permissive; the callee fails closed).
  - `createInternalAuthMiddleware()` — verifies via `verifyInternalToken`; 503 on `InternalTokenNotConfigured`, 401 on any `{ok:false}`, `next()` on `{ok:true}`.
  - New `requireAlertmanagerToken` middleware in `alertmanager-auth.ts`: constant-time compare of the bearer against `ALERTMANAGER_INGEST_TOKEN`; 503 unconfigured, 401 mismatch. Keeps `tokenMatches`'s exact constant-time shape (Global Constraint 5).

**Notes:**
- `internalAuthHeaders` becoming async means its callers (`review-bridge.ts`, `scan/trigger.ts`, `fix/trigger.ts`, `chat-handler.ts`, `approval-worker.ts`, `context-map-index.ts`) must `await` it. Update every call site; they already `await` the surrounding fetch, so this is threading one `await` through. **List every changed file explicitly in the commit** (Global Constraint 9 / Phase 2 rule — no directory pathspecs while concurrent agents are live).
- In `server.ts`, `/alerts/incoming` must use `requireAlertmanagerToken`, NOT the signed verifier — Alertmanager cannot mint a JWT. Every other guarded route (`/internal/*` mount, `/api/approvals/:id/execute`, `/staging/send`, `/scan/trigger`, `/fix/trigger`, `/internal/model-connections/test`) uses the signed verifier.

- [ ] Step 1: Failing test — signed verifier accepts a `mintInternalToken('arete-webhook')` bearer and 401s a legacy random string; Alertmanager guard accepts the static token and 401s a signed JWT (they are different credentials now).
- [ ] Step 2: Run — FAIL.
- [ ] Step 3: Implement the two guards; thread `await internalAuthHeaders()` through all six outbound call sites.
- [ ] Step 4: Run webhook unit tests — PASS.
- [ ] Step 5: Typecheck webhook — PASS.
- [ ] Step 6: Commit with an explicit file list.

**Review:** security-critical. Confirm `/alerts/incoming` is unreachable with a signed token *and* with the old shared secret, and reachable only with `ALERTMANAGER_INGEST_TOKEN`; confirm the internal routes reject the legacy static secret (clean cutover).

---

### Task 3: Dashboard mints signed tokens

**Files:**
- Modify: `packages/dashboard/src/lib/internal-auth.ts`
- Add dep: `@arete/internal-token` to `packages/dashboard/package.json`
- Modify callers to `await`: `lib/agent-chat.ts`, `lib/context-map-client.ts`, `lib/code-map-file-api.ts`, `lib/model-connections-api.ts`, `lib/issue-pipeline/staging-client.ts`, and the API routes importing the helper (`app/api/scan/route.ts`, `app/api/work-items/[id]/fix/route.ts`, `app/api/containers/[id]/send/route.ts`, `app/api/model-connections/route.ts`)
- Test: `packages/dashboard/src/lib/internal-auth.test.ts`

**Interfaces:**
- `internalAuthHeaders(): Promise<Record<string,string>>` — mints `iss:'arete-dashboard'`; `{}` when unconfigured. Server-side only (Global Constraint: token never reaches the browser — the file already documents this).

- [ ] Step 1: Failing test — header carries a JWT whose `iss` is `arete-dashboard` and that the shared verifier accepts.
- [ ] Step 2: FAIL. Step 3: Implement + `await` all call sites. Step 4: dashboard typecheck + affected tests PASS. Step 5: Commit (explicit file list).

**Review:** spot-check (small, mirrors Task 2's mint half).

---

### Task 4: Python `internal_token.py` (PyJWT) — mint + verify, format-pinned

**Files:**
- Create: `packages/agents/src/arete_agents/internal_token.py`
- Modify: `packages/agents/src/arete_agents/internal_auth.py` (verify via the module)
- Modify: `packages/agents/src/arete_agents/tools/memory.py:111-114` (mint via the module)
- Modify: `packages/agents/pyproject.toml` (add `pyjwt`), config `internal_api_token` becomes the keyset (see below)
- Test: `packages/agents/tests/test_internal_token.py`, update `tests/test_internal_auth.py`

**Interfaces (mirror Global Constraint 6 exactly):**
- `mint_internal_token(iss: str, *, now: int | None = None) -> str`
- `verify_internal_token(authorization: str | None, *, now: int | None = None) -> VerifyResult` — a dataclass/tuple `(ok: bool, reason: str | None, iss: str | None, kid: str | None)`. Same reason strings as TS: `no_header|malformed|unknown_kid|bad_signature|expired|wrong_audience`. Raises `InternalTokenNotConfigured` only when the keyset is unconfigured.
- `load_keyset()` reading `INTERNAL_TOKEN_SIGNING_KEYS` (JSON) + `INTERNAL_TOKEN_ACTIVE_KID` from Settings-then-environment, same fallback ladder `configured_token()` uses today (Settings first so `.env` is honoured, bare-env fallback so a keyless boot can still reject).

**Notes:**
- Use `jwt.encode(..., algorithm="HS256", headers={"kid": kid})` and `jwt.decode(..., algorithms=["HS256"], audience="arete-internal", leeway=5)`, catching `ExpiredSignatureError`→`expired`, `InvalidAudienceError`→`wrong_audience`, `InvalidSignatureError`/`DecodeError`→`bad_signature`. Read the `kid` from `jwt.get_unverified_header` first to select the key (unknown kid → `unknown_kid`, never attempt verify).
- `require_internal_token` (in `internal_auth.py`) keeps its FastAPI signature and 503/401 posture; only the check body swaps to `verify_internal_token`.
- **Cross-language pin:** `test_internal_token.py` loads `docs/superpowers/fixtures/internal-token-vector.json` and asserts (a) `mint_internal_token` with the fixture inputs reproduces the exact compact string TS produced, and (b) verify accepts it before `exp` and reports `expired` after. This is the guard that the two languages never drift.

- [ ] Step 1: Failing tests — round trip, the five reason cases, and the shared-vector reproduction.
- [ ] Step 2: FAIL. Step 3: Implement `internal_token.py`; swap `internal_auth.py` verify; swap `memory.py` mint. Step 4: `pytest packages/agents/tests/test_internal_token.py tests/test_internal_auth.py -v` PASS. Step 5: `ruff check` clean (Phase 2 lesson — implementers ran pytest but not ruff). Step 6: Commit (explicit file list).

**Review:** security-critical. Reviewer confirms the shared vector actually matches TS's (not a Python-only self-consistency), and runs the expiry/kid mutations.

---

### Task 5: Provisioning + rotation runbook

**Files:**
- Modify: `.env.example` (replace the single `INTERNAL_API_TOKEN` guidance with `INTERNAL_TOKEN_SIGNING_KEYS`, `INTERNAL_TOKEN_ACTIVE_KID`, `INTERNAL_TOKEN_TTL_SECONDS`, and the separate `ALERTMANAGER_INGEST_TOKEN`)
- Modify: `docker-compose.prod.yml` (the three services), `infra/docker-compose.yml` + `infra/alertmanager.yml` (Alertmanager now uses `ALERTMANAGER_INGEST_TOKEN` as its `credentials_file` source)
- Create: `docs/ops/internal-token-rotation.md` (the rotation + revocation procedure from Global Constraint 7, as an operator runbook)

**Notes:**
- The signing keys are the same JSON on all three of our services (single host env fanned out, exactly like the old single literal). `ALERTMANAGER_INGEST_TOKEN` is provisioned on the webhook (to verify) and Alertmanager (to present) only.
- Keep `INTERNAL_API_TOKEN` out of the compose files entirely once cutover lands, so a stale value can't silently re-authorize anything. Grep the tree for `INTERNAL_API_TOKEN` and confirm the only remaining references are historical comments, not live reads.

- [ ] Step 1: Update env/compose/alertmanager. Step 2: Write the runbook. Step 3: `grep -rn INTERNAL_API_TOKEN` — confirm no live code path still reads it (all reads moved to the keyset in Tasks 1–4). Step 4: Commit.

**Review:** spot-check with a security lens on the grep result (no orphaned live read of the retired secret).

---

### Task 6: MCP auth honesty — real token exchange, fail-closed

**Files:**
- Modify: `packages/agents/src/arete_agents/mcp/auth.py` (replace both `simulated_token_for_{code}` sites — lines ~90 and ~101)
- Modify: `packages/agents/src/arete_agents/mcp/manager.py` (server record gains `token_url`, `expires_at`, `refresh_token`; `update_server_token` stores expiry)
- Test: create `packages/agents/tests/test_mcp_auth.py` (there are zero tests today)

**Behaviour:**
- After receiving the authorization `code`, POST `grant_type=authorization_code&code=...&redirect_uri=...&client_id=...` to the server's configured `token_url` (a new field on the server record; if absent, **do not** fabricate — print an honest "token endpoint not configured; server left unauthenticated" and leave `status="Needs authentication"`). Model the request/response handling on `packages/webhook/src/oauth/oauth-token-exchange.ts` (real `authorization_code` exchange, `expires_at = now + expires_in`).
- On a real token response, store `access_token`, `expires_at`, and `refresh_token` (when present) via `update_server_token`, set `status="Authenticated"`, and only then print success.
- On a non-2xx or missing `access_token`, print the real error and leave the server unauthenticated. Never store a placeholder. Same rule in the manual-fallback branch (line ~101).
- The consumption path (`client.py:_connect_http`) already sends `server["token"]` as a Bearer — a real access token flows end-to-end with no consumer change. (Refresh-on-expiry is out of scope this phase; note it in the backlog.)

- [ ] Step 1: Failing tests — with a mocked `token_url` returning `{access_token, expires_in}`, the flow stores the real token + `expires_at` and reports success; with `token_url` unset, it stores nothing and leaves `status="Needs authentication"`; with a 400 from the endpoint, it stores nothing and returns the error. Assert `simulated_token_for_` never appears in any stored value.
- [ ] Step 2: FAIL. Step 3: Implement. Step 4: `pytest tests/test_mcp_auth.py -v` PASS + `ruff check` clean. Step 5: Commit.

**Review:** security-critical (a live Bearer sent to third-party servers in the review path). Confirm no code path stores or presents a fabricated token, and the unconfigured path fails closed rather than "succeeding".

---

# THEME 2 — Frontend consumption of the healing data

### Task 7: Incident detail view

**Files:**
- Modify: `packages/dashboard/src/lib/incidents.ts` — add `getIncidentDetail(db, installationIds, id)`
- Create: `packages/dashboard/src/app/(dashboard)/incidents/[id]/page.tsx` (server component, mirrors `reviews/[id]/page.tsx`)
- Modify: `packages/dashboard/src/components/dashboard/incidents/incident-list.tsx` — each row links to `/incidents/[id]`
- Modify: `packages/dashboard/src/components/dashboard/sidebar.tsx` — add an "Incidents" entry (deep-linkable; optional but preferred)
- Test: `packages/dashboard/src/lib/incidents.test.ts` (extend)

**Interfaces:**
- `getIncidentDetail(db, installationIds: string[], id: string): Promise<IncidentDetail | null>` — **tenant-scoped**: `where: { id, installationId: { in: installationIds } }`. A row outside the caller's installations returns `null`, indistinguishable from a missing id (Global Constraint 4). Resolves the linked `WorkItem` (via `workItemId`) to a fix-run link the same way `getIncidents` already does, and returns the scrubbed `payload` (labels/annotations), `startsAt`, `resolvedAt`, `severity`, `status`, `summary`.
- The page renders the timeline (`startsAt` → `resolvedAt`), the alert labels/annotations from `payload`, and a first-class "View fix run" link. Reuse `overview/page.tsx`'s `SectionLabel`/`StatePanel` helpers and the `reviews/[id]` back-link scaffold. Match Tailwind semantic tokens (`bg-surface-1`, `text-content-*`, `text-accent-*`).

- [ ] Step 1: Failing test — `getIncidentDetail` returns the row for an in-scope id and `null` for an out-of-scope id (cross-tenant probe: same id, different installation → null).
- [ ] Step 2: FAIL. Step 3: Implement query + page + row link + sidebar entry. Step 4: `getIncidentDetail` tests PASS; dashboard typecheck PASS. Step 5: Commit (explicit file list).

**Review:** the **query** is security-critical (tenant scope) — full review of `getIncidentDetail`; the page/markup is spot-checked.

---

### Task 8: Surface fix-run cooldown in the Services UI

**Files:**
- Modify: the Services work-item view (`packages/dashboard/src/components/dashboard/services/*` + its `lib/issue-pipeline/*` view-model) to include `fixFailureCount`/`fixFailureAt`
- Reuse: `packages/dashboard/src/lib/fix-cooldown.ts` `computeFixCooldown` (already consumed by the fix API route)
- Test: the view-model test that computes the badge state

**Behaviour:**
- When a work item is cooling down (`computeFixCooldown` reports a remaining interval), render a "retry available in Xm" badge and disable/annotate the "Fix it" action, so the user sees the 429 reason *before* clicking rather than after. No backend change — `fixFailureCount`/`fixFailureAt` are already on `WorkItem`; this is a read of two existing columns plus the existing pure function.
- Keep the `fix-cooldown.ts` drift-guard pins intact (they mirror the webhook copy — Phase 2 Task 6). If the badge needs the policy constants, import them; do not re-derive.

- [ ] Step 1: Failing test — a work item with `fixFailureAt` = now and `fixFailureCount` = 2 yields a "cooling down" view state with a positive remaining seconds; an item with no failures yields "ready".
- [ ] Step 2: FAIL. Step 3: Implement the view-model field + badge. Step 4: tests + typecheck PASS. Step 5: Commit.

**Review:** spot-check.

---

# THEME 3 — Harness efficiency (inspectable fixes)

### Task 9: Bound review fan-out concurrency

**Files:**
- Modify: `packages/agents/src/arete_agents/orchestrator.py` (the `self.graph.invoke({"pr": pr})` call, ~line 655)
- Modify: `packages/agents/src/arete_agents/config.py` (add `review_max_concurrency: int`)
- Test: `packages/agents/tests/test_orchestrator*.py` (extend, or a focused new test)

**Behaviour:**
- Pass `config={"max_concurrency": settings.review_max_concurrency}` to `graph.invoke` (the mechanism already used at `remediation.py:126`). Default `REVIEW_MAX_CONCURRENCY = 8`. This bounds simultaneous provider calls across the (files × 6 agents) fan-out; today it is unbounded.
- Do **not** change the fallback ThreadPool path (`max_workers=min(len(tasks),12)`) — leave it; note in the report that the two caps now both exist.
- **Measurement is deferred** (documented, Global Constraint / Scope): the *value* of a specific N is only observable under a real large PR + real Anthropic key. This task lands the bound and a sane default; it does not claim to have tuned N. Say so in the report.

- [ ] Step 1: Failing test — assert `graph.invoke` is called with a `config` carrying `max_concurrency` equal to the configured value (patch/spy the compiled graph). Step 2: FAIL. Step 3: Implement. Step 4: test + `ruff` PASS. Step 5: Commit.

**Review:** spot-check.

---

### Task 10: Stop double-retrying reviews that already produced findings

**Files:**
- Modify: `packages/webhook/src/worker.ts` (the review `catch` at ~lines 98–113)
- Test: `packages/webhook/src/worker.test.ts` (or the nearest covering test)

**Behaviour:**
- Today `runReviewPipeline` failures re-throw (`worker.ts:112`), so BullMQ (`attempts:3`) re-runs the **entire** files × agents review — on top of the per-agent `with_retry(2)` inside Python. Distinguish: if the pipeline produced a usable review result (partial success — some agents failed but findings exist), **do not re-throw**; record the degraded outcome on the check run and return. Re-throw only for a genuine infra crash that yielded no result (so `attempts:3` still covers transient total failures). Mirror the fix queue's return-don't-throw contract (`fix/queue-consumer.ts:5-24`).
- This removes the outer full-review retry for the common partial-failure case; it does not touch the per-agent retry (that stays) or the fix queue.

- [ ] Step 1: Failing test — a pipeline run that returns a partial result does NOT throw (job not retried); a pipeline run that throws an infra error DOES propagate (job retried). Step 2: FAIL. Step 3: Implement. Step 4: tests + typecheck PASS. Step 5: Commit.

**Review:** spot-check with an eye on not swallowing a real crash (silent-failure risk) — the infra-error path must still propagate.

---

### Task 11: `review-pr-heavy` queue has no consumer — wire it or fail loudly

**Files:**
- Modify: `packages/webhook/src/worker.ts` (start a Worker on the heavy queue) OR `packages/webhook/src/webhook-handler.ts:114` (routing) — implementer chooses per what the brief finds
- Test: the covering worker/handler test

**Behaviour:**
- PRs >50 files are routed to `review-pr-heavy` (`webhook-handler.ts:114`) but `worker.ts` starts a Worker only on the fast queue — so the largest PRs are enqueued and **never processed** (silent). Two acceptable fixes, pick one and justify in the report:
  1. Start a Worker on the heavy queue with its own (lower) concurrency, running the same `processGitHubPullRequest`.
  2. If a separate heavy lane isn't warranted yet, route heavy PRs onto the fast queue and drop the unused heavy queue, so nothing is silently enqueued to a lane with no consumer.
- Either way, **no PR may be enqueued to a queue that has no consumer** (that is the defect). If the heavy lane stays, the Task 9 concurrency bound applies there too.

- [ ] Step 1: Failing test — a >50-file PR ends up on a queue that a running Worker consumes (assert the consumer exists for whatever lane the PR lands on). Step 2: FAIL. Step 3: Implement. Step 4: tests PASS. Step 5: Commit.

**Review:** spot-check (correctness: no orphaned enqueue).

---

### Task 12: Correct the non-gating "budget" naming; record the deferred quality question

**Files:**
- Modify: `packages/agents/src/arete_agents/agents/base.py:13-14` (rename/comment `MAX_TOOL_ROUNDS`, `MAX_PATCH_CHARS` to make explicit they gate the **review** path only and are not consulted by the fix pipeline)
- Modify: `docs/roadmap/backlog.md` (record the deferred item: "is haiku adequate to *author* fixes for performance/quality/test_coverage? — needs a real Anthropic key + regression corpus; do not change the tier blind")

**Behaviour:**
- Pure clarity change: the two constants are computed/named as "budgets" but the fix pipeline (`fix_pipeline.author_patch`) never references them (it has `MAX_LINES_PER_FILE` and wall-clock timeouts instead). Rename to review-scoped names or add a one-line comment stating they are review-only, so a future reader doesn't assume the fix path is bounded by them. No behaviour change.
- Add the deferred haiku-authoring question to the backlog with its evidence pointer (`fix_pipeline.py:313`, `config.py:49-51`).

- [ ] Step 1: Rename/comment + backlog entry. Step 2: `ruff` + agents test suite still green (no behaviour change). Step 3: Commit.

**Review:** spot-check.

---

## Final whole-branch review

After Task 12, dispatch one whole-branch review on the most capable model, package via `scripts/review-package <merge-base> HEAD`. Focus the constraints block on: Global Constraints 3 (fail-closed), 5 (constant-time), 6 (single wire format across languages — the shared vector actually pins TS↔Python), 7 (rotation/revocation semantics), and 4 (tenant scope on `getIncidentDetail`). Feed it the running roll-up of Minor findings. Fix Critical/Important with a single fix subagent carrying the complete list.

## Definition of Done

1. `INTERNAL_TOKEN` mutation test passes: a token with `exp` in the past → 401 on both the TS verifier and the Python verifier. **Expiry is now expressible and tested** — the Phase 2 unmet gate is closed.
2. Rotation and revocation are exercised by tests (non-active kid accepted while present; removed kid rejected).
3. The TS↔Python shared vector test passes on both sides (one wire format, proven).
4. `/alerts/incoming` accepts only `ALERTMANAGER_INGEST_TOKEN`; internal routes reject the retired static secret (clean cutover confirmed by grep + tests).
5. MCP auth stores a real token or fails closed — `simulated_token_for_` appears nowhere in stored values; unconfigured `token_url` leaves the server unauthenticated with an honest message.
6. The dashboard renders an incident detail view (tenant-scoped) and a fix-run cooldown badge.
7. Review fan-out is bounded by `max_concurrency`; no PR is enqueued to a consumer-less queue; the review double-retry is removed for partial-success; the review-only budgets are named honestly.
8. All CI checks green. Deferred items (concurrency N tuning, haiku-fix-quality, MCP refresh-on-expiry, RFC 8414 discovery) recorded in the backlog with their evidence, not silently dropped.
