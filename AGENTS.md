# Start here

This is **Kuma** (repo name Areté) — an AI code-review and software-healing service.
Read these three before writing any code.

| Read | Why |
|---|---|
| [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md) | The mission, the honesty rules, the HITL moat, the tenancy and BYO-model contracts, and the working rules. **What never to do.** |
| [`docs/roadmap/master-build-status.json`](docs/roadmap/master-build-status.json) | The catalogue of what is built, what is half-wired and what remains — 85 items, ranked by priority, grouped into stages, each with provenance. **What to do.** ([generated markdown view](docs/roadmap/master-build-status.md).) |
| [`.claude/ade-coordination.md`](.claude/ade-coordination.md) | Who owns which package right now. Claim one, and declare cross-package edits **before** editing. |

> **Two build-status records exist right now, and that is a known, temporary split.**
> The `/build-status` **page** renders `packages/dashboard/src/lib/feature-readiness.ts`.
> The **catalogue** above — and `packages/dashboard/data/build-tracker.json`, its conversion
> into the `build-tracker` schema — is the fuller record: it holds the ~60 never-started
> ideas the page does not yet show. Three lanes built a tracker in parallel; converging
> them is tracked in `.claude/ade-coordination.md` and
> `docs/status/2026-07-23-nautilus-closeout.md`. Read the catalogue for *what is left*,
> the page for *what ships today*, and assume neither is complete on its own.

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

Edit `docs/roadmap/master-build-status.json` — it is checked in, so the build log's history is git
history. Every item needs a `source` (the doc, commit or `file:line` it came from) and an `addedBy`.
A duplicate `id` means two lanes recorded the same thing: reconcile the entries, do not append.
The `.md` beside it is **generated** — never edit it by hand.

---

*Historical note: this file previously read "AGENT NOTICE: NEW UI WORKSPACE — this workspace
(`arete-marble`) contains the NEW, light white UI environment on the `feat/marble-ink-foundation`
branch." Neither that workspace nor that branch exists in this repository, so the notice misled
every agent that opened it. Replaced rather than left in place.*
