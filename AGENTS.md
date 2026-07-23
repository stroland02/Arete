# Start here

This is **Kuma** (repo name Areté) — an AI code-review and software-healing service.
Read these three before writing any code.

| Read | Why |
|---|---|
| [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md) | The mission, the honesty rules, the HITL moat, the tenancy and BYO-model contracts, and the working rules. **What never to do.** |
| [`packages/dashboard/data/build-tracker.json`](packages/dashboard/data/build-tracker.json) | **The single record** of what is built, what is half-wired and what remains — 85 items, each with provenance, importance and phase. **What to do.** Contract: `packages/dashboard/src/lib/build-tracker/schema.ts`. |
| [`.claude/ade-coordination.md`](.claude/ade-coordination.md) | Who owns which package right now. Claim one, and declare cross-package edits **before** editing. |

> **One record, deliberately.** Three lanes built a build-status tracker in parallel and a
> second record (`docs/roadmap/master-build-status.json`) briefly existed alongside this one.
> It is **retired** — two records drift, and the drift always wins. Its curated themes survive
> as `tags` on the items (`honesty-security`, `onboarding-install`, `sdlc`,
> `product-commercial`, `surface`, `parked`). If you are about to author a second catalogue:
> don't. Extend this one. History in `docs/status/2026-07-23-nautilus-closeout.md`.
>
> Two things not to misread: an item with **no `verifiedAt` has never been verified** — the
> seed transcribed the audits it cites rather than re-confirming each against the code, so
> absence must never render as a tick. And **`programmes` is an array**, because four
> numbering systems run here at once; an item outside all four carries none rather than an
> invented one.

## The three rules that have already cost hours

1. **`prisma migrate deploy`, never `prisma db push`.** Every worktree shares one Postgres;
   `db push` syncs it *down* to your schema and silently drops other people's columns.
2. **Do not take another worktree's port or stop its dev server.** Check what is running first.
3. **Claim one package** (`agents` / `webhook` / `dashboard` / `infra` / `docs`) and declare
   anything outside it in the coordination file before you start.

## Definition of done

Tests pass and you ran them · `tsc --noEmit` clean · you drove the real flow in the app, not just
the test · no fabricated data · one small honest commit · a close-out entry naming what shipped,
what is still open, and what you deliberately did not do.

## Changing the backlog

Edit `packages/dashboard/data/build-tracker.json` — it is checked in, so the build log's history is
git history. Every item needs `provenance` (the doc, commit or session it came from); the parser
rejects a row without one unless its `origin` is `user`. `id` is frozen kebab-case and is never the
title, so a row can be reworded without losing its history. A duplicate `id` means two lanes recorded
the same thing: reconcile the entries, do not append. A `blockedBy` entry must resolve to another
item id, or carry an `ext:` prefix if the blocker is outside the tracker.

Do not add a second catalogue file. That has already happened once and had to be undone.

---

*Historical note: this file previously read "AGENT NOTICE: NEW UI WORKSPACE — this workspace
(`arete-marble`) contains the NEW, light white UI environment on the `feat/marble-ink-foundation`
branch." Neither that workspace nor that branch exists in this repository, so the notice misled
every agent that opened it. Replaced rather than left in place.*
