# Close-out — `nautilus` worktree (2026-07-23)

Branch `feat/master-build-status`, off `origin/main` @ `a21f956`. Format per
`docs/runbooks/2026-07-22-agent-closeout.md`: what shipped, what is open, what contradicts the
plan, what was deliberately abandoned.

**Lane:** `docs` + a narrow additive slice of `dashboard`. Declared in `.claude/ade-coordination.md`
before editing. No schema change, no migration, no `packages/webhook`, no `packages/agents`, no
`infra`. **Nothing in `ridley` / `horseshoe` / `pyrosome` was touched, and no running dev server
was stopped** — this worktree served on **:3005**, leaving :3000 and :3002 alone.

## Why this lane existed

The backlog was spread across `docs/roadmap/backlog.md` (414 lines), the 07-23 reachability
roadmap, `docs/status/2026-07-22-build-status-map.md`, five close-out reports and several closed
agent sessions. `/build-status` showed 25 of those items, statically, with no priority, no phase
progression, and no way to edit — so good ideas kept being recorded in a doc the next session never
opened.

## Shipped

| Work | Evidence |
|---|---|
| `docs/roadmap/master-build-status.json` — **85 items across 11 stages**, each with priority, status, size, readiness level, gap, `source` and `addedBy` | the file |
| `docs/roadmap/master-build-status.md` — generated view for agents, written by the same writer so it cannot drift | `store.ts renderMarkdown` |
| `docs/PRINCIPLES.md` — mission, honesty rules, HITL moat, tenancy + BYO contracts, working rules, consolidated from four scattered sources | the file |
| `/build-status` rebuilt: mission + principles strip, per-stage progression rail, status/priority filters, importance-ordered rows, inline add/edit/remove | `build-status-board.tsx`, `page.tsx` |
| `GET/POST/PATCH/DELETE /api/build-status`, session-required and fail-closed behind `BUILD_STATUS_EDITABLE` + non-production | `app/api/build-status/route.ts` |
| `AGENTS.md` rewritten as a real entry point (it described a workspace and branch that do not exist) | `AGENTS.md` |
| 36 new tests | `manifest.test.ts` (18), `store.test.ts` (18) |

**Gate:** dashboard **710 tests / 96 files green**, `tsc --noEmit` clean, `next build` green
(`/build-status` compiles as `ƒ`), eslint **0 errors** (73 warnings, all pre-existing
`no-explicit-any` in test files — the documented ratchet; none from this lane).

## Verified by driving the real flow, not only the suite

On `:3005`, against the real checked-in files:

- Unauthenticated `GET`, `POST` and the page all **307 to `/login`** — the auth proxy refuses
  before the handler runs, so an anonymous visitor cannot author repo files.
- Authenticated `GET` → `editable: true`, `disabledReason: null`, 85 items, 11 stages.
- `POST` a probe row → **200**, and the id appears in **both** the JSON and the generated markdown.
- `PATCH` its priority → **200**, and `"priority": "P3"` became `"priority": "P0"` **on disk**.
- `DELETE` → **200**, and both files returned **byte-identical to baseline**
  (`md5 874d6773…` / `c52cbbbf…` before and after). `git status` shows no residue.
- Refusals proven, not assumed: duplicate id → **409**; unknown stage → **422** with the previous
  file intact (validation runs before persist); deleting an item two others list in `blockedBy` →
  **409** naming both dependents.

## Open (not started, not claimed by me)

1. **No route-level test.** The gate's three env combinations are covered as units in
   `store.test.ts`, and the 401/403 paths were driven live — but there is no committed test pinning
   the route's own behaviour. A future change to the proxy could reopen it with a green suite.
2. **`git` is not consulted.** An item's `status` is hand-maintained. Nothing cross-checks a
   `shipped` claim against the commit it names, so the manifest can go stale the same way
   `backlog.md` did. A checker would be a real improvement.
3. **Every item's content is transcription, not re-verification.** The claims come from the audits
   named in each `source` field; I did not independently re-confirm each one against the code. The
   `source` is there precisely so the next reader can.
4. **`.env.local` was copied from `ridley`** to run the dev server, with `AUTH_URL` repointed to
   :3005. It is gitignored and not committed, but this worktree therefore shares the dev Postgres.

## Contradicts the plan / discovered mid-flight

- **`AGENTS.md` was actively misleading.** It announced an `arete-marble` workspace on a
  `feat/marble-ink-foundation` branch. Neither exists (`git ls-remote --heads origin` → 22 heads,
  no match). It is the first file an agent opens. Replaced, with a historical note recording what
  it said rather than silently erasing it.
- **`lib/feature-readiness.ts` had exactly one importer** — the page this lane rewrote — so it
  became dead on contact. Deleted rather than left as an unused shim, matching the treatment the
  backlog already prescribes for `synth-ledger.tsx`.
- **Three PMs were given this same task in parallel** (stated by the product owner mid-session).
  The manifest is therefore designed to *merge*: items sort by `(stage, id)`, every item carries
  `addedBy`, and a duplicate `id` throws with "reconcile … rather than appending". Whichever lane's
  **code** lands first, the other lanes' **items** should be merged into it — three competing
  `/build-status` implementations would repeat the `dashboard-ui-redesign` vs `dashboard-ui-port`
  waste already recorded in `.claude/ade-coordination.md`.
- **The audit corrected two stale claims** on the old page: the HITL approval gate is no longer
  "built but unreachable" (Stage 1.1–1.3 shipped it), and the outbound retry worker is running.
  Both are now recorded at their true status.

## Deliberately abandoned

- **Building any of the 85 items.** This lane produced the map and the instrument, not the work.
- **Correcting `backlog.md`'s 7 stale entries.** It is a high-traffic file another worktree may be
  editing, and the correction is already tracked as `correct-tracking-docs`. Only a pointer block
  was prepended; no existing entry was altered or removed.
- **A DB-backed store.** The build status is not tenant data, agents cannot read a table without a
  connection, and every schema change on the shared Postgres has cost this project time. A
  checked-in JSON makes the build log's history the git history.

---

## Amendment (same day) — this lane DEFERS on the schema

After the above was written, `pyrosome`'s coordination entry became visible. It declares the schema
and seed claim on **2026-07-22** and sets the tiebreak: *"First declaration wins; the tiebreak is the
earlier `declared` date."* This lane declared **2026-07-23**. **Their claim wins; this lane defers.**
`src/lib/build-tracker/schema.ts` is the contract.

Their contract is also genuinely better specified than this lane's: `lane` separates audited
inventory from never-started ideas, `programmes[]` is an array of refs so four numbering systems stay
separate, `importance` reuses the existing `severityTone()` vocabulary instead of adding a primitive,
`rank` is sparse so an insert never renumbers, and `provenance` is *structurally* required rather
than merely conventional.

**The catalogue was already authored, so it was converted rather than discarded.**
`packages/dashboard/scripts/seed-build-tracker.mjs` emits `packages/dashboard/data/build-tracker.json`
in their shape: **85 items — 24 `inventory`, 61 `idea` — 4 programmes, 8 principles, 0 contract
violations.** It self-validates and refuses to write on any breach.

Choices that could have been faked and were not:

- **`verifiedAt` is absent on every row.** This transcribes the audits named in each `provenance`; it
  did not re-confirm each claim against the code. Absence must never read as verification.
- **Items outside the four numbering systems carry no programme ref**, rather than an invented one.
  `tenant-telemetry-ingest` carries two, because it genuinely is observability Phase 3 *and* product
  P4 — which is precisely why the field is an array.
- **`open` splits on importance**: P0/P1 → `next`, P2/P3 → `someday`. Calling a P3 idea "next" would
  overstate the queue.
- **`inventory` is 24, not the old page's 25.** "Webhook delivery retries" folds into the outbound
  webhooks row now that the retry worker runs. A consolidation, stated rather than left as an
  unexplained count drop.

### The three-way collision, as it actually stood

Off the same parent `a21f956`, `origin/main` unmoved throughout:

| Lane | Ref | Approach |
|---|---|---|
| `pyrosome` | `stroland02/setup-live-website-dev` @ `461b1b4` | schema + pure logic + tests. **Owns the contract.** |
| third lane | `origin/feat/master-build-status` @ `d6bf492` → `af9f34f` (advanced mid-session) | extends `feature-readiness.ts`, adds `build-status-editor.tsx` |
| `nautilus` | `origin/stroland02/build-status-seed` @ `9a5dd1a` | the seed, plus a page/route/board of its own |

This lane's branch was originally named `feat/master-build-status` — the same name the third lane had
already pushed, making the two **siblings** rather than fast-forwards. It was **renamed** to
`stroland02/build-status-seed` before pushing. Nothing was force-pushed; no other lane's ref moved.

Hard conflicts that remain for whoever merges: `api/build-status/route.ts` (this lane and the third
lane both create it), `feature-readiness.ts` (this lane **deletes** it, the third lane **adds 197
lines** to it), and `build-status/page.tsx` (all three rewrite it).

**This lane's UI is offered, not claimed.** It is complete, tested and driven, but it sits on its own
branch and blocks nobody. Which UI merges is the product owner's call. The seed is portable to any of
the three, and is the part that cost the sweep.

**Also carried forward from `pyrosome`:** `.claude/ade-coordination.md` has **forked between
worktrees** — lines 1–341 are common, and after that each copy holds only its own lane's claims. The
file that exists to prevent collisions cannot currently be read completely from any single checkout.
Whoever reconciles branches next must **union the tails**, not overwrite one with the other.
