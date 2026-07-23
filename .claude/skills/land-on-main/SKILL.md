---
name: land-on-main
description: Use when about to commit or push anything to main in this repo - four agents push to one branch, so this is the gate that stops a broken main. Covers fetch-rebase-verify-push, conflict resolution by intent, and what to do when the push is rejected.
---

# Landing on main without breaking it

Four agents push to `main` in this repo, unattended, all day. `main` is the integration
point and it moves under you *while you work* — that is not an edge case here, it is the
normal case. This skill is the gate.

Adapted from the `no-mistakes` pre-push pipeline (validate in isolation, block the push
until checks pass, auto-fix the mechanical and escalate the judgment calls). The specifics
below are this repo's, learned by getting them wrong.

## The rule

**Never push without running the affected package's tests first.** Not "the build is
green", not "it typechecks" — the tests for the package you touched. A green typecheck has
shipped a broken `main` in this repo before.

## The sequence

Run this every time. It is short.

```bash
git fetch origin -q
git rev-list --left-right --count origin/main...HEAD   # behind<TAB>ahead
```

1. **Behind > 0?** Rebase. Never merge.
   ```bash
   git rebase origin/main
   ```
   Merging a stale branch here resurrects work another lane deliberately superseded.
2. **Check the lanes** — the cheapest stage, and the only one that catches *wasted* work
   rather than broken work.
   ```bash
   node scripts/lanes.mjs check
   ```
   Exit 1 means this checkout has changed a file another lane owns, two lanes claim one
   file, or you built something the tracker already calls shipped. The last of those has
   happened four times. That is why this stage is here.
3. **Run the tests for what you touched** (see the table below).
4. **Push**, then **re-check** — the push can still be rejected because main moved during
   your test run.
   ```bash
   git push origin HEAD:main && node scripts/lanes.mjs heartbeat
   ```
   The heartbeat records where this lane is. A lane that has not checked in for six hours
   is reported as possibly stale, so its file claims can be released rather than blocking
   everyone else indefinitely.
5. **Rejected?** Go back to step 1. This happened twice in one session. It is routine, not
   an emergency.

## Which tests, for what you touched

| You changed | Run | Takes |
|---|---|---|
| `packages/dashboard` | `npx vitest run` in that package | ~20s |
| `packages/webhook` | `npx vitest run --no-file-parallelism` | ~60s |
| `packages/agents` | `uv run pytest -q` **and** `uv run ruff check <files>` | ~45s |
| `packages/db` | `npx vitest run`, and `pnpm run build` if `src/` changed | ~15s |
| Anything TypeScript | `npx tsc --noEmit` in that package | ~20s |
| `infra/otel-collector-config.yaml` | validate against the real image (see below) | ~30s |

**`packages/webhook` needs `--no-file-parallelism`.** Its full suite reports ~12 failures
under parallel execution on a loaded machine — cold-module-build timeouts, not regressions.
They pass individually and serialized. Do not "fix" them; do not treat them as a red build.

**Collector config** validates with a throwaway environment, because the credentials come
from env by design:

```bash
docker run --rm -e CLICKHOUSE_DB=validate -e CLICKHOUSE_USER=validate \
  -e CLICKHOUSE_PASSWORD=validate \
  -v "<abs-path>/infra/otel-collector-config.yaml:/etc/otelcol/config.yaml" \
  otel/opentelemetry-collector-contrib:0.156.0 validate --config=/etc/otelcol/config.yaml
```

Note it exits 0 with unset variables too — `validate` checks structure, not connectivity.

## Resolving a conflict: by intent, not by side

Pick `--ours` / `--theirs` only when you know which *intent* is correct. Defaults that
apply here:

- **`.claude/ade-coordination.md` — always union.** Two lanes appending their claims is the
  file working as designed. Losing one is losing a lane's declaration.
- **`packages/dashboard/data/build-tracker.json` — take main's copy, then re-apply your own
  edit on top.** Another lane's row changes must not be dropped to preserve yours.
- **A lockfile or `package.json` — take main's, then run `pnpm install`.** Hand-merging a
  lockfile produces one that resolves for nobody.
  **Then rebuild any package whose `src/` moved** — a stale `dist/` gives
  `Cannot find module '@arete/db/telemetry'`, which is a build artifact problem wearing a
  missing-dependency costume. This exact resolution broke the build once.

After any conflict resolution, run the tests again. The merge itself is a change.

## Before you commit

- **Check the branch.** `git branch --show-current`. Another agent's checkout can change
  under you.
- **Additive claims stay additive.** If the change is meant to add only, prove it:
  `git diff origin/main -- <file> | grep -c "^-[^-]"` should be `0`.
- **Write the honest commit message.** State what you verified and what you did *not*. If
  something is fixed only partway, say which half — a message claiming more than the diff
  delivers is how a tracker row becomes a lie.

## What to escalate instead of deciding

Auto-fix the mechanical. Escalate anything that changes intent:

- A schema change or migration (`packages/db/prisma/schema.prisma` — one writer at a time).
- Merging another lane's branch wholesale.
- Amending a frozen spec (the §5 scrubbing pattern set), or anything the docs call "a
  decision, not a patch".
- Deleting a file another lane may still import.

Leave these in `.claude/ade-coordination.md` for a human, and keep going with the rest.
