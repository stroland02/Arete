# Agent Close-Out Runbook

**Purpose:** end a session so `main` holds the most current work and nothing stale can
resurface. Run this in every worktree before closing its chat.

**The failure this prevents:** an old branch looks unmerged, someone merges it "to be
safe", and it regresses `main` by reintroducing superseded code. On 2026-07-22 six of
eight unmerged branches were stale duplicates whose work had already landed under
different commit hashes.

---

## Part A — per-agent close-out (each agent, in its own worktree)

Run in order. Do not skip step 4; "tests passed earlier" is not evidence.

```bash
# 1. Nothing left behind
git status --porcelain                 # must be empty
git log --oneline @{u}..HEAD           # must be empty (everything pushed)

# 2. Take main's latest, so you resolve conflicts — not the merger
git fetch origin
git merge origin/main --no-edit

# 3. Reinstall if deps or schema moved
pnpm install
pnpm --filter @arete/db exec prisma migrate deploy   # NEVER `db push`

# 4. Prove it still works — paste this output into your close-out report
pnpm --filter @arete/dashboard exec tsc --noEmit
pnpm --filter @arete/dashboard exec vitest run

# 5. Push and open a PR into main
git push origin HEAD
gh pr create --base main --fill
```

**Then write a close-out report** stating: what shipped (with test counts), what is still
open, anything discovered that contradicts the plan, and any work deliberately abandoned
— name it, so nobody later mistakes a dead branch for pending work.

**Do not** delete your branch yourself, stop another worktree's dev server, or run
`prisma db push`.

---

## Part B — repo-level reconciliation (coordinator, once all agents report)

### B1. Confirm every worktree is drained

```bash
for d in $(git worktree list --porcelain | awk '/^worktree /{print $2}'); do
  printf "%-12s dirty=%-3s unpushed=%-3s ahead=%s\n" "$(basename $d)" \
    "$(git -C $d status --porcelain | wc -l)" \
    "$(git -C $d log --oneline @{u}..HEAD 2>/dev/null | wc -l)" \
    "$(git -C $d rev-list --count origin/main..HEAD 2>/dev/null)"
done
```

All three columns must read `0`. A non-zero `ahead` means that worktree still owes a PR.

### B2. Classify every remote branch — the anti-regression step

`git cherry` compares by patch-id, so it reports a branch as "new" whenever `main` has
moved on, **even when the same work is already there under a different hash**. Never
merge on this signal alone.

```bash
for b in $(git branch -r --format='%(refname:short)' | grep -v 'origin/HEAD'); do
  printf "%-52s in-main=%-3s new=%-3s last=%s\n" "$b" \
    "$(git cherry origin/main $b | grep -c '^-')" \
    "$(git cherry origin/main $b | grep -c '^+')" \
    "$(git log -1 --format='%cr' $b)"
done
```

Then for each branch reporting `new > 0`, decide with **artifact evidence**, not hashes:

1. Read the commit subjects: `git log origin/main..origin/<branch> --oneline`
2. For each, check whether its artifact already exists on `main` — the column, file, or
   symbol it introduced:
   ```bash
   git show origin/main:packages/db/prisma/schema.prisma | grep -c '<column>'
   git ls-tree origin/main --name-only <path>/
   ```
3. Classify:
   - **Superseded** — artifacts present on `main`. Do not merge. Tag and delete (B3).
   - **Genuinely missing** — artifacts absent *and* still wanted. Rebase onto `main`,
     re-verify, PR.
   - **Abandoned** — artifacts absent and no longer wanted. Tag and delete.

**Age is a strong prior.** A branch older than about a week whose artifacts are on `main`
is superseded, not pending.

### B3. Retire dead branches reversibly

Tag before deleting, so nothing is truly lost:

```bash
git tag archive/<branch-name> origin/<branch-name>
git push origin archive/<branch-name>
git push origin --delete <branch-name>
```

Recover later with `git checkout -b <name> archive/<name>`.

### B4. Sync every worktree to the new main

```bash
for d in $(git worktree list --porcelain | awk '/^worktree /{print $2}'); do
  git -C "$d" fetch origin -q
  git -C "$d" merge --ff-only origin/main 2>/dev/null || echo "$(basename $d): needs a real merge"
done
```

The dogfood worktree is included — but coordinate its restart with the product owner
rather than restarting it yourself.

### B5. Final assertion

```bash
git log origin/main --oneline -1
git branch -r --format='%(refname:short)' | grep -v HEAD | while read b; do
  [ "$(git rev-list --count origin/main..$b)" != "0" ] && echo "STILL UNMERGED: $b"
done
echo "clean if nothing printed above"
```

---

## Standing hazards to re-check at every close-out

- **All worktrees share one Postgres.** `prisma db push --accept-data-loss` syncs the
  shared DB down to your schema and drops other people's columns. Fixed in `dev-all.mjs`
  on `main` (now `migrate deploy`) — but a worktree that has not pulled `main` still
  carries the old script.
- **Give each worktree its own database and port.** `CREATE DATABASE arete_<worktree>`,
  then set it in **both** `packages/dashboard/.env.local` and the root `.env` — the
  dashboard reads the former, the Prisma CLI the latter.
- **`AUTH_URL` is pinned to a port.** Serving on another port lets login succeed but
  redirects to whichever worktree owns the pinned one.
- **One dogfood server.** Everyone else uses a distinct port.
