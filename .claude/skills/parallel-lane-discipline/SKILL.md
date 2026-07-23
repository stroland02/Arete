---
name: parallel-lane-discipline
description: Use before editing any file in this repo, and before picking up any new piece of work — four agents build here at once from four checkouts, so confirm the file is yours and the task is not already someone else's before you touch it.
---

# Lane discipline

Four agents work this repo in parallel. The cost of getting this wrong is
already measured: **four consecutive duplicate commits**, where two lanes did
the same work within half an hour of each other, and one abandoned branch that
built a second tracker engine alongside the first.

Ownership is in `.claude/lanes.json`, which a script evaluates. The prose in
`.claude/ade-coordination.md` carries the reasoning; the JSON carries the
constraint. Read the JSON before you edit; append to the prose when you claim.

## Before the first edit of a session

```bash
node scripts/lanes.mjs check
```

Exit 1 means a real conflict — resolve it before writing code. Warnings are
information: read them, decide, continue.

Then, for any file you did not write this session:

```bash
node scripts/lanes.mjs owner <path>
```

- **Your lane** → edit it.
- **Another lane** → do not edit. Put what you need in
  `.claude/ade-coordination.md` as a request, and work on something else. A
  cross-lane edit that seems trivial is the one that produces the 2am conflict.
- **`shared`** → edit, and *append* — never rewrite another lane's entry. An
  overwrite destroys the record that would have shown the collision.
- **unclaimed** → claim it in `.claude/lanes.json` in the same commit, or the
  next lane to touch it collides with you.

## Before picking up new work

`lanes.mjs check` rejects a queue entry that another lane already shipped, that
another lane has also queued, or that no tracker item matches. Add the item id
to your lane's `queue` and run it. This is the cheapest possible moment to
discover someone beat you to it.

Pick from the tracker, not from memory:

```bash
node scripts/lanes.mjs board
```

## When your work is a decision rather than a patch

Some items cannot be taken unsupervised. The test: **would being wrong be
silent?** Broadening a redaction pattern, reversing a documented fallback,
changing a frozen convention — a wrong call there produces no error, just
quietly different behaviour everywhere at once.

Record it in `.claude/ade-coordination.md` with what you would have done and why
you stopped, then take the next item. Do not guess, and do not stall.

## Every 30 minutes of autonomous work

```bash
node scripts/lanes.mjs heartbeat
```

A lane quiet for six hours is reported as possibly stale, so its claims can be
released rather than blocking everyone indefinitely.

## What this does not do

It does not stop you. It reports. A lane that runs the check, reads an error and
edits anyway has defeated it — the honest limit of any convention between agents
that can all write to the same disk.
