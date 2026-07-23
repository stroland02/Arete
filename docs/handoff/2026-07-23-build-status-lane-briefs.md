# Build status — briefs for the three lanes, 2026-07-23

Three project managers are running autonomous loops against the same feature.
This is the day's work split so they stop landing the same commit.

## The catalogue is already unioned — verified, not assumed

All four copies of `packages/dashboard/data/build-tracker.json` carry an
**identical set of 85 item ids**: `main` (via the Kuma2 checkout, at `dc56c75`),
`ridley`, `pyrosome`, and the superseded `stroland02/build-status-rows` branch.
Zero ids exist in one and not another, in either direction.

So no lane is holding an idea the others lost. What differs is *enrichment* —
main carries 56 rows with `verifiedAt` and longer `evidence` strings; the other
checkouts are behind on that, and one field (`silence-a-finding.works`) exists
only in the working copies. Everyone should rebase onto main rather than merge
tracker JSON.

**The gap is not data. It is that most of the page the plan described was never
built, and the JSON carries fields nothing reads.** That is what these briefs
cover.

## What is verifiably missing, as of `dc56c75`

Each of these was checked against the code on main, not inferred from the plan:

| # | Gap | Evidence |
|---|-----|----------|
| 1 | **Remove is a hard delete of any catalogued idea.** No `dropped` state, no restore, no confirm — a `<select>` of all 85 items and one button. | `api/build-status/route.ts` DELETE filters the item out and writes; `State` union has no `"dropped"` |
| 2 | **No concurrency guard on the write path.** Read-modify-write with no hash or mtime check, while three loops and their agents edit the same file. | `route.ts` `read()` → mutate → `writeFile`, no comparison |
| 3 | **`provenance` is not required on add.** POST stamps `origin: "session"` and never asks where the idea came from. | `route.ts` item literal omits `provenance` entirely |
| 4 | **The 8 principles are dead data.** They are in the JSON and rendered nowhere; the page shows `mission.northStar` only. | `grep -rn "principles" packages/dashboard/src --include=*.tsx` → no matches |
| 5 | **No focus rail.** `importance` and `rank` both exist; nothing ranks across lanes to answer "what next". | no such export in `src/lib/build-tracker.ts` |
| 6 | **`blockedBy` renders raw ids.** A reader sees `agents-layer-inside-services`, not a title, and `ext:` blockers are undistinguished. | `page.tsx:288` `blockedBy.join(", ")` |
| 7 | **Not in the sidebar.** Reachable only from a link on Settings. | `settings/page.tsx:162` is the sole in-app link |
| 8 | **`feature-readiness.ts` is still on main: 507 lines, zero importers.** A second, stale source of truth for exactly this data, whose docblock tells the reader to keep it in sync with the status doc. | `grep -rn "feature-readiness" src` → no importers |
| 9 | **`rank` is written as `max+1`**, colliding with the sparse 10/20/30 scheme the data uses. | `route.ts` rank assignment |

Ordering rationale: **1 and 2 are the only two that destroy work.** Everything
else is a missing surface. Fix those first regardless of lane.

---

## Lane A — view · `ridley`

Already working in `packages/dashboard/src/components/dashboard/`. Stay there.

**Owns:** `app/(dashboard)/build-status/page.tsx`, new components under
`components/dashboard/build-status/`, `components/dashboard/sidebar.tsx`.

1. **Principles band** (gap 4). Render the 8 principles as `<details>` — title in
   the summary, quote plus its `source` path in the body. No client JS; the page
   is a server component and has no reason to stop being one. This is the half of
   the user's ask that is currently thrown away at render time.
2. **Focus rail** (gap 5). Top 7 open items across both lanes, consuming Lane B's
   `focusRail()`. Empty state says *"Nothing is ranked above medium"* — never a
   checkmark.
3. **Blocker titles** (gap 6). Consume Lane B's `resolveBlockers()`. An `ext:`
   blocker renders as prose, not a fake id.
4. **Sidebar entry** (gap 7). `sidebar.tsx` is contested — declare it in
   `.claude/ade-coordination.md` before the first edit.

**Do not touch:** `src/lib/build-tracker.ts`, `api/build-status/route.ts`,
`data/build-tracker.json`.

---

## Lane B — engine · `pyrosome`

**Owns:** `src/lib/build-tracker.ts` and its tests, `src/lib/feature-readiness.ts`.

1. **Publish the contract first**, before A or C can compile against it: add
   `"dropped"` to `State`, and the optional `droppedAt` / `droppedReason` fields.
   A and C are both blocked on this — it lands first, alone.
2. `focusRail(tracker, n)` — open items sorted by `(importance, rank)`, both
   lanes, excluding `shipped` and `dropped`.
3. `resolveBlockers(item, tracker)` — ids to titles, `ext:` prefixes to prose.
4. `nextRank(tracker)` — sparse step of 10, fixing gap 9 at the source rather
   than in the route.
5. **Delete `feature-readiness.ts`** (gap 8). Zero importers; keeping a stale
   parallel record of build status inside the build-status feature is the exact
   failure this tracker exists to prevent.

**Do not touch:** `page.tsx`, any component, `route.ts`, the JSON.

---

## Lane C — data and write path · `Kuma2` checkout

Already 56 rows deep in the verification sweep. Keep going, and own the writer.

1. **Drop, don't delete** (gap 1). DELETE sets `state: "dropped"` with a reason
   and a date; only items whose `origin` is `"user"` are truly removed. The
   button says "Drop". This is the highest-value fix on the list — right now one
   click behind a dropdown destroys a catalogued idea with no confirm and no undo.
2. **Hash guard** (gap 2). Hash the bytes on read, send it to the client, compare
   on write. Mismatch returns 409 with *"the tracker changed on disk since this
   page loaded — reload and reapply"*. Three loops are editing this file today;
   this is not hypothetical.
3. **Require provenance** (gap 3) for any `origin` other than `"user"`. An agent
   must cite the doc, commit or session that recorded the idea.
4. **Finish the sweep.** 56 of 85 rows carry `verifiedAt`; 29 do not.

**Do not touch:** `src/lib/build-tracker.ts`, `page.tsx`, `sidebar.tsx`.

---

## Sequencing

Lane B's step 1 is the only cross-lane dependency. It is one commit, and it
lands before A's drop-state rendering or C's drop route. Everything after that
is disjoint by file.

Gaps 1 and 2 are the two that lose work. If a lane finishes early, it picks up
nothing — it re-reads this list and confirms the other lane landed its item,
because four consecutive duplicate commits is what this document exists to stop.
