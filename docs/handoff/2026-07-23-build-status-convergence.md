# Build-status convergence — plans for the three lanes

**Date:** 2026-07-23 · **Written by:** Lane B (pyrosome) · **origin/main:** `c8e4d57`

Three lanes built one feature. This is the plan to converge them, and the two
verified facts that should drive it.

---

## Two facts, both checked against code — not taken on trust

### 1. The catalogue and the engine already fit. The page swap is unblocked today.

`data/build-tracker.json` (85 items, landed by Lane C in `c8e4d57`) and
`src/lib/build-tracker/*` (the parser, landed by Lane B in `d961ade`) were
written by two lanes that never spoke directly — they agreed only through the
schema published in `.claude/ade-coordination.md`.

**Verified: it parses clean. 0 contract violations, 82 tests green**
(`catalogue.test.ts`, commit `fb6ffa1`). Every id unique, every `blockedBy`
resolves, every programme/phase reference lands, every non-user row carries
provenance.

So Lane A's page can be pointed at the catalogue **without the data changing
first**. That takes the page from 24 rendered rows to 85.

### 2. Two of the three P0 rows on the page are stale — in the alarming direction.

`feature-readiness.ts` on main asserts three P0 gaps. P0 means *"the product is
not trustworthy or sellable while this is open."* Checked each against
`origin/main`:

| Row | Verdict | Evidence |
|---|---|---|
| Security agent returns fabricated results | **Correct** | the fix (`4789bdb`) is branch-only, not on main |
| Internal API token never expires — *"expiry is not expressible in the current code path"* | **STALE** | main's `internal-auth.ts` mints/verifies via `@arete/internal-token` — HS256, `exp`+`kid`, 401 on expired. Closed by `9399330`, which **is** on main |
| MCP tokens are plaintext, **and the OAuth exchange is faked** | **3 of 4 claims wrong** | `mcp/auth.py` does a real `httpx.post` exchange and computes `expires_at` (L76-81, L130-135); L145 says *"This used to fabricate `simulated_token_for_{code}`"*; `manager.py:38` creates the file `0o600` atomically. Only **"plaintext"** is still true on main |

This is the hazard the project's own principle names: *"an entry asserting a
live security gap that no longer exists misstates the security posture of
shipped code."* Both rows should get a `needsVerification` note or a correction
with evidence — **not** a silent rewrite.

---

## The division: A = view, B = engine, C = data

It maps to what each lane already built best, and no two lanes own a file.

### Lane A — owns the view

**Files:** `build-status/page.tsx`, `build-status-editor.tsx`,
`api/build-status/route.ts`. Nobody else touches these.

1. **Point the page at `data/build-tracker.json`** via `src/lib/build-tracker/`.
   Highest-value action available to anyone right now: 24 rows → 85, and the
   ~61 unstarted ideas stop being invisible.
   - Use `readinessTotals()` for the summary chips. It counts the **inventory
     lane only** — deliberately. Counting ideas would take "not wired up" from
     roughly 10 to roughly 60 and turn an honest summary into an alarmist one.
   - Use `groupByArea()` for the existing sections, `ideaGroups()` for the
     catalogue, `focusRail()` for a ranked top-N, `programmeProgress()` for the
     phase strip.
2. **Render the four programmes as separate rails.** They are four numbering
   systems, not one sequence. `programmeProgress()` never sums across them, and
   each programme carries a `standing` (`current`/`stale`) plus a one-sentence
   `caveat` that must be shown — a reader needs it *before* trusting any number.
3. **Fix the two stale P0 rows** (above), since `feature-readiness.ts` is Lane
   A's file while the page still imports it.
4. **Pick one editor gate.** `NODE_ENV` (A) vs `BUILD_STATUS_EDITABLE` (C).
   Recommend `NODE_ENV !== "production"`: it cannot be switched on by accident
   in a deployed environment, and the honest reason to show a disabled control
   is *"a deployed container has no repo working tree to write to."*
5. **Surface `verifiedAt`.** It is absent on all 85 rows — the catalogue
   transcribes audits, it did not re-confirm each claim. Absence must render as
   *"never verified"*, never as a tick.

### Lane B — owns the engine *(this lane; done)*

**Files:** `src/lib/build-tracker/{schema,parse,mutate,select}.ts` + tests.

- **Landed** on `stroland02/build-status-rows` (`d961ade`, `fb6ffa1`), branched
  from `c8e4d57`. Ready to merge; touches no contested file.
- Provides: `parseTracker` / `serializeTracker`, the mutations
  (`addItem`, `dropItem`, `restoreItem`, `removeUserItem`, `moveItem`,
  `patchItem`, `markVerified`) and the selectors listed above. All pure — no
  I/O, no clock — so Lane A can call them from a server component or an action.
- **Not doing:** authoring a second seed. Lane C's catalogue is on main, in this
  schema, validated. One record.

### Lane C — owns the data

**Files:** `data/build-tracker.json`, `scripts/seed-build-tracker.mjs`,
`docs/roadmap/master-build-status.*`.

1. **Retire the duplicate UI branch.** It conflicts with A on `page.tsx`,
   `route.ts` and `feature-readiness.ts`. Confirmed standing down.
2. **Keep the catalogue growing** as ideas surface; `parseTracker` rejects an
   uncited non-user row, so provenance stays enforced.
3. **Reconcile the two records.** `docs/roadmap/master-build-status.json` and
   `data/build-tracker.json` are both on main. Two records drift — pick one as
   canonical and make the other derived or delete it.

---

## Hazards — please read before merging anything

- **Do not delete `feature-readiness.ts` until Lane A's page stops importing
  it.** It is the page's only data source today; deleting it first breaks
  `/build-status` outright.
- **Lane B's *other* branch (`stroland02/setup-live-website-dev`) contains a
  SECOND `data/build-tracker.json`** — an 84-item catalogue written before Lane
  C's landed. **It must not be merged as-is**; it would collide with main's
  catalogue at the same path. Lane B is retiring it. The rest of that branch
  (MCP credential encryption, webhook endpoint management, the FIFO memory
  archive, the SecurityAssessor de-fabrication, two test root-cause fixes) is
  unrelated and still wants a separate, rebased merge.
- **`.claude/ade-coordination.md` has forked.** Lines 1–341 are common; after
  that each checkout holds only its own lane's claims. Resolve as a **union**,
  never an overwrite — `fb6ffa1` did exactly that and both tails survive.
- **Rebase onto fresh `origin/main`, never merge a stale branch.** Main moved
  twice during the writing of this document (`af9f34f` → `c8e4d57`).

---

## The one decision that closes the split

**Does Lane A's page adopt `data/build-tracker.json`?**

If yes, the split closes and ~61 hidden items appear. If no, say so explicitly —
otherwise main carries two build-status records indefinitely and they will
drift, which is the exact failure the last several repair commits were spent
undoing.
