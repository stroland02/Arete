# M1 blocker — a scan can never complete against a slow model

**Lane:** `D-verify` (owns `packages/webhook/src/scan/**`) · **Date:** 2026-07-23
**Status:** analysed and scoped; **not started** — the fix changes a service contract, and that
is escalated rather than decided by an unattended lane.

## Why this one matters more than its tracker rank suggests

It is the whole of the "dashboards are empty" symptom. Against any model slower than ~5 minutes
per repo, a scan **cannot succeed, ever, no matter how many retries**. The diagnosis is already
complete in `docs/roadmap/backlog.md` — this document only adds the code-level shape and the
decision needed.

**It has no row in `packages/dashboard/data/build-tracker.json`.** The closest,
`scan-completion-signal`, is a different defect (a `setTimeout(reload, 1500)` in the Services UI).
So the repo's most consequential defect is absent from the record that is supposed to be the single
source of truth. **`C-data` owns that file — please add it**; `D-verify` did not, because writing
into another lane's file is what this coordination system exists to prevent.

## The mechanism, at the line

`packages/webhook/src/scan/trigger.ts:221-233` — `fetchScan` is a bare `fetch` with no dispatcher:

```ts
const res = await fetch(`${getServiceConfig().pythonServiceUrl}/scan`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(await internalAuthHeaders()) },
  body: JSON.stringify(body),
})
```

Node's `fetch` (undici) defaults `headersTimeout` to **300 s**. The agents `/scan` endpoint sends
response headers only when the *entire* scan is finished, so a run slower than five minutes can
never return headers in time. The ceiling is structural, not incidental: observed failure at 307 s
(300 s + connection overhead) while the agents service kept working for another seven minutes and
completed six model calls into a closed socket.

`/scan/trigger` itself already answers `202` promptly (`server.ts:261-278`). The blocking call is
one layer down, inside `maybeStartScan`.

## Two shapes, and why the cheap one was not taken

**A — disable the header timeout (stopgap).** Pass a dispatcher with `headersTimeout: 0`.
*Blocked on a dependency decision:* `undici` is not a dependency of `packages/webhook` and is not
hoisted into `node_modules`, so this needs an addition to `packages/webhook/package.json` and
`pnpm-lock.yaml` — shared files, and a lockfile change while three other lanes are pushing.
It also leaves the real defect: the call stays synchronous over an unbounded LLM workload, and any
dropped connection still discards completed work. `backlog.md` argues against it explicitly.

**B — enqueue and ack (the durable shape, and the one the backlog endorses).** Model it on
`/fix/trigger`, which already does exactly this at `server.ts:298-317`: validate, `enqueueFixDrive`,
answer `202 { started: true }`, and let the bounded-concurrency BullMQ worker persist progress.
BullMQ is already a dependency (`bullmq`, `bullmq-otel`), and `FIX_QUEUE_CONCURRENCY` shows the
pattern for a separate lane with its own concurrency.

## What B actually requires — the part that needs a decision

This is not a webhook-only change. It alters the contract between two services:

1. **agents `POST /scan` must ack, not block.** Today it returns findings in the response body.
   It would need to accept the job, answer immediately, and report completion another way.
2. **A completion path back.** Either the agents service calls back into the webhook's internal
   surface when finished, or the webhook polls a run-status endpoint. That is a new endpoint on one
   side or the other, and it needs the internal-token guard either way.
3. **`ScanRun` becomes the source of truth for progress**, rather than the HTTP response — which is
   the right outcome regardless, because it is what makes a slow run *slow* instead of *failed*.

**Why an unattended lane should not just build this:** it changes a published service contract,
touches `packages/agents` (whose `/scan` handler is unowned but adjacent to `B-engine`'s `mcp/**`),
and a half-landed version leaves scans worse than they are now — currently they fail cleanly, and a
partial migration could fail silently. The `land-on-main` skill lists "a service contract change"
under escalate-instead-of-deciding, and this is that.

## Recommended sequencing, when someone takes it

1. `C-data` adds the tracker row so the work is visible in the record.
2. Decide A-then-B (unblock the demo today, migrate properly after) or B-only. A is roughly one
   dependency plus three lines; B is a day across two services.
3. If B: agents `/scan` acks first, behind a flag, with the synchronous path still available —
   so the migration is reversible and the two can be compared on the same repo.
4. Verify by driving, not by tests alone: the observation that proved the diagnosis was
   `uvicorn` logging **zero completed `POST /scan` access lines** while the model kept working.
   The fix is proven when a scan against a deliberately slow local model persists findings.

## Environment notes recorded while investigating (not product defects)

From `backlog.md`, still true and worth carrying: a `.env` predating the internal-token JWT
migration carries `INTERNAL_API_TOKEN` but neither `INTERNAL_TOKEN_SIGNING_KEYS` nor
`INTERNAL_TOKEN_ACTIVE_KID`, so every internal-token-guarded call answers 503 until a keyset is
added to all three processes. And `uv run --env-file` silently loads nothing from that `.env` (it
chokes on the escaped multi-line `GITHUB_PRIVATE_KEY`), so the agents service must receive those
variables explicitly.
