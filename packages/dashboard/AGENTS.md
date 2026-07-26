<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# The master build-status list

`data/build-tracker.json` is the single hand-authored record of what is built, half-wired,
or unbuilt — surfaced in the product at `/build-status`. Read it through the typed
selectors in `src/lib/build-tracker.ts`; never re-derive its rules in a component.

- `importance` is how much it matters; `level` is how finished it is. They are independent.
- `lane` splits the record in two: `inventory` is what exists (24 rows), `idea` is what is
  worth building (61). **Readiness counts cover the inventory lane only** — counting ideas
  would take "not wired up" from 9 to ~60 and present a working product as a broken one.
- **No `verifiedAt` means never verified.** The seed transcribed audits rather than
  re-confirming each claim against code, so absence must never render as a tick. Set it
  only when you have actually checked, and cite the evidence.
- `programmes` is an array — four numbering systems run at once, and one is flagged stale.
  Render them as separate rails; a blended percentage across them is meaningless.
- Every claim carries `file:line` evidence so a reader can falsify it. Keep that up.
- In development, `/build-status` can add and remove entries; it writes back to this file,
  so the change arrives as a reviewable git diff.

`src/lib/feature-readiness.ts` was the predecessor. It is **deleted** — it had drifted into a
second, stale answer to the same question, which is the failure the tracker exists to prevent.
Git has what it used to claim, if you need it.

## Reading the tracker

- `isOpen(item)` is the test for "still real work" — neither `shipped` nor `dropped`.
- `focusRail(tracker, n)` answers *what next*, across both lanes, by importance then rank.
- `resolveBlockers(item, tracker)` turns `blockedBy` ids into titles. It returns an `"unknown"`
  entry for an id nothing matches rather than filtering it out — a broken reference must not
  make a blocked item look unblocked.
- `nextRank(tracker)` is how a new row gets a rank. Ranks are sparse (step of 10) so inserting
  between two rows never renumbers the rest.
- **Removing an item means `state: "dropped"` with a `droppedAt` and a `droppedReason`**, not
  deletion — for anything except a row a person added by hand. Dropped rows leave both lanes and
  every count derived from them, and are shown by `droppedItems()`.
<!-- END:nextjs-agent-rules -->

# NEVER run `next build` into the dev server's directory

`next dev` and `next build` both default to `.next`. Building while the dev
server is running overwrites the manifests that server is reading, and the
browser starts serving **stale chunks** — the app looks like it reverted to an
older version, as if the work had been lost. It has not; the dev output was
simply clobbered. (This happened on 2026-07-23 and cost real confusion.)

Verification builds therefore go somewhere else:

```bash
NEXT_DIST_DIR=.next-verify pnpm --filter @arete/dashboard exec next build && rm -rf packages/dashboard/.next-verify
```

Clean it up afterward (the `&& rm -rf` above): `.next-verify` is throwaway build
output, and if it lingers, `pnpm run lint` will lint the generated bundles as if
they were source and fail. ESLint's ignore list is config-protected, so removing
the directory is the right fix, not adding an ignore.

`next.config.ts` reads `NEXT_DIST_DIR` and falls back to `.next`, so CI and the
Docker image are unaffected. If you do clobber it, restart the dev server — it
recompiles from source and nothing is lost.

**This worktree serves :3002. `:3000` belongs to another worktree and must never
be stopped.** Confirm who owns the port before touching anything:

```powershell
Get-NetTCPConnection -LocalPort 3002 -State Listen | Select-Object OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId = <pid>" | Select-Object CommandLine
```
