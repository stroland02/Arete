# The parallel-agent workflow, 2026-07-23

Four agents build this repo at once. This is how they stay out of each other's
way, and what was borrowed from where.

## What was actually going wrong

Not a shortage of process — there was plenty. The failures were:

1. **Four consecutive duplicate commits.** Two lanes did the same work within
   half an hour of each other, repeatedly. Nobody was careless; there was simply
   no moment at which "someone already has this" could be discovered cheaply.
2. **The coordination file forked between worktrees.** `.claude/ade-coordination.md`
   reached 871 lines, and a still-open exclusive claim written in one checkout was
   invisible from another. The file that prevents collisions could not be read
   completely from any single checkout.
3. **Claims never expired.** Nothing distinguished "I am working on this" from
   "I wrote this down two days ago".
4. **Nothing gated `main`.** Four agents push to it all day.

Every one of these is prose failing to be a constraint. So the fix is not more
prose.

## What was adopted, and from where

| Source | Idea taken | How it lands here |
|---|---|---|
| [`kunchenguid/no-mistakes`](https://github.com/kunchenguid/no-mistakes) | A gate in front of the remote: nothing reaches the push target until every check is green. Findings split into *auto-fix* and *ask-user* tiers. | Already adopted, independently, by another lane as `.claude/skills/land-on-main/` (`df77db1`) — which carries better specifics than a second version would have: the per-package test table, the `--no-file-parallelism` finding for webhook, and conflict resolution by intent. This lane wrote a duplicate, read theirs, deleted its own, and grafted in the one stage theirs could not have had: `lanes.mjs check`, plus a heartbeat after the push. Two skills for "how to push" is the same dual-source failure that got `feature-readiness.ts` deleted. |
| [`mattpocock/skills`](https://github.com/mattpocock/skills) | `to-tickets`: decompose work into tickets with **declared blocking dependencies**, so the record is a graph rather than a list. `code-review`: two independent axes (standards, spec) never merged, so one cannot mask the other. `writing-great-skills`: front-load the leading concept, state positive targets rather than prohibitions, keep reference behind pointers. | `blockedBy` already exists on every tracker item and now resolves to titles via `resolveBlockers()`, with an explicit `unknown` for a broken reference rather than a silent filter. The three new skills follow the authoring rules. |
| [`anthropics/claude-cookbooks`](https://github.com/anthropics/claude-cookbooks) | `patterns/agents`: orchestrator–workers, and evaluator–optimizer as *separate* roles. | The **verify lane** below. An agent that both builds and signs off on its own work is not evaluating anything. |
| [`asgeirtj/system_prompts_leaks`](https://github.com/asgeirtj/system_prompts_leaks) | Reference only — how instructions to agents are phrased at scale. | Skill descriptions state triggers rather than identity. Nothing from this repo is copied. |
| superpowers · ECC (installed already) | `systematic-debugging`: no fix before root cause; after three failed fixes, question the architecture rather than attempting a fourth. ECC's fact-forcing gate: state facts before the first touch of a file. | Already in force, and referenced from `ship-gate`'s "when a stage fails". |

## The mechanism

`.claude/lanes.json` says who owns what. `scripts/lanes.mjs` evaluates it.

```bash
node scripts/lanes.mjs check      # exit 1 on a real conflict
node scripts/lanes.mjs board      # the standup view
node scripts/lanes.mjs owner <p>  # who owns this path
node scripts/lanes.mjs heartbeat  # I am alive, and here is where
```

It resolves globs against `git ls-files` rather than comparing glob strings, so
two patterns that look different but match the same file are still caught. Five
checks run:

- **overlap** — two lanes claiming one file (error)
- **trespass** — this checkout has changed a file another lane owns (error).
  Counts uncommitted and untracked changes too: catching it at commit time is
  catching it after the work is already done.
- **stale queue** — you queued something already shipped, already queued by
  another lane, or matching no tracker item (error)
- **empty claim** — a glob matching nothing real (warning)
- **heartbeat** — a lane quiet for over six hours (warning)

The error paths were verified against a fixture rather than assumed: a
deliberately broken `lanes.json` produces all four errors and exit 1.

**The honest limit:** this reports, it does not block. A lane that reads an error
and edits anyway has defeated it. That is true of any convention between agents
that can all write to the same disk, and claiming otherwise would be exactly the
kind of false assurance this product exists to avoid.

## The lanes

| Lane | Checkout | Owns |
|---|---|---|
| **A — view** | `workspaces/Arete/ridley` | the build-status page, its components, the sidebar |
| **B — engine** | `workspaces/Arete/pyrosome` | `lib/build-tracker.ts` and its tests, `agents/mcp/**` |
| **C — data + write path** | `Kuma2/Arete` | `build-tracker.json`, the API route, the editor |
| **D — verify** | the localhost dogfood instance | **nothing** |

### The verify lane

D owns no source file, deliberately. It runs the app, drives real flows, and
files what it finds — against the tracker, and against whichever lane owns the
file. It does not fix them.

This is the cookbook's evaluator–optimizer split. A lane that fixes what it finds
stops looking once it has found something it can fix, and its report becomes a
description of its own patch rather than of the product.

What D files is worth more than what it fixes: `verifiedAt` on a row checked
against running code, and `file:line` evidence for a row that was wrong. The
tracker has already been wrong in both directions this week — it called a closed
security gap live, and called a live SSE row two-thirds stale.

## The daily loop

1. `standup` — read the board, take the top unclaimed item that fits your lane.
2. Add its id to your lane's `queue`; `lanes.mjs check` rejects it if someone
   beat you to it.
3. Build it. Root cause before fix; a regression test proven to fail without it.
4. `land-on-main` — rebase, lane check, tests, push, heartbeat.
   `node scripts/smoke-localhost.mjs` for the drive-it stage; it reports which
   checkout each port is serving, which is the difference between "my change is
   broken" and "that port is another lane's worktree on another branch".
5. Every 30 minutes of autonomous work: heartbeat, and re-read the board. Another
   lane may have landed your next item while you worked. That has now happened
   five times, including to the gate skill described in the table above.

## What is deliberately not automated

**Deciding.** An item whose gap says "this is a decision, not a patch" —
broadening a frozen redaction pattern set with real false-positive risk on
ordinary prose, reversing a documented upgrade-safety fallback — gets recorded in
`.claude/ade-coordination.md` with what would have been done and why it stopped,
and the lane takes the next item instead.

The test is whether being wrong would be **silent**. A wrong regex widening
throws no error; it quietly changes what every sink stores, everywhere, at once.
That is the class of change that waits for a person.
