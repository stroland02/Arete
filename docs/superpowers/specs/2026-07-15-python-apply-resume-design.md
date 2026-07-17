# P1.3 — Python apply/resume for approved infra fixes (Option B)

**Date:** 2026-07-15 · **Owner:** Engineer-3 (`stroland02/Engineer-3`) · **Package:** `packages/agents` (in-lane)

## Problem

An operator can APPROVE an infrastructure fix, but nothing applies it. On approve,
`executeApproval()` (webhook) durably marks the `ApprovalPrompt` `EXECUTED` and enqueues
`{approvalId, reviewId, command}` onto the `approval-exec` BullMQ queue. The Python side is
simulated: `request_infrastructure_approval` (`tools/actions.py`) returns a fake
`"…Resuming…"` string, and no code applies the command or resumes the paused run.

This spec makes the fix **real**: apply the approved command and resume through a genuine
LangGraph `interrupt()` → checkpoint → `Command(resume=…)` cycle, idempotent per `approvalId`.

## Current state (verified read)

- `/review` (`server.py:56`) → `ReviewOrchestrator.run` → `graph.invoke` (`orchestrator.py:551`).
  The graph is compiled with a bare `workflow.compile()` (`orchestrator.py:295`) — **no
  checkpointer, no `interrupt()`.** It fans out and runs to `END` in one synchronous call.
- `request_infrastructure_approval` runs inside `base.py`'s synchronous tool loop
  (`base.py:216`) and returns a fake "paused/resuming" string. Nothing suspends.
- `ApprovalPrompt` (`schema.prisma:121`) has `id, reviewId, command, reason, status,
  executedAt` — **no `runId`/`threadId`/checkpoint reference.** There is no persisted linkage
  from an approval back to a suspended run.

**Consequence:** literal "resume the *same* original `/review` run" is impossible today
(that run never checkpointed, and nothing records a thread). PM confirmed **Option B**: build
the real interrupt/checkpoint/resume machinery keyed on `approvalId`, in-lane, and flag the
cross-lane wiring (schema `threadId` + checkpointed review path) as deploy follow-up.

## Fixed contract (not modified)

```
POST /approvals/apply
body:    { approvalId: str, reviewId: str, command: str }
returns: { status: "applied" | "failed", detail: str, resumedRunId?: str }
IDEMPOTENT per approvalId — a redelivered job MUST NOT double-apply.
```

## Design

### Components (all new except the one `server.py` route + the truthful tool sentinel)

| File | Purpose |
|---|---|
| `remediation.py` | `RemediationGraph` (real `InMemorySaver` checkpointer + `interrupt()`), plus `apply_and_resume(approval_id, review_id, command, executor)` — the endpoint entrypoint. |
| `tools/executor.py` | `CommandExecutor` protocol; `SubprocessCommandExecutor` (real), `MockCommandExecutor` (sandbox/tests). Selected by env. `CommandOutcome{ran, exit_code, stdout, stderr}`. |
| `server.py` | **+1 route** `apply_approval()` → `POST /approvals/apply`. Nothing else touched. |
| `tools/actions.py` | `request_infrastructure_approval` returns a **truthful** "suspended, awaiting approval" sentinel via shared `build_approval_request()`; stops lying about resuming. |

### The interrupt/checkpoint/resume cycle (LangGraph 1.2.9 — verified APIs)

`from langgraph.types import interrupt, Command`; `from langgraph.checkpoint.memory import InMemorySaver`.
Graph compiled `.compile(checkpointer=InMemorySaver())`, thread-keyed by `approval_id`:

```
request_approval ── interrupt({command, reason}) ──▶ [SUSPENDS; checkpoint saved]
      │  (human approves out-of-band → webhook enqueues → Eng1 worker calls POST /approvals/apply)
      ▼  resume: Command(resume={"approved": True})
apply_command ── executor.run(command) ──▶ CommandOutcome ──▶ [checkpointed atomically]
      ▼
incorporate ──▶ RemediationResult{applied: bool, detail} ──▶ END
```

`apply_command` is a **node**, so the checkpointer records its output atomically — that is
what gives exactly-once apply on redelivery (under a durable saver).

### `apply_and_resume` algorithm (idempotency + no double-apply)

```
config = {"configurable": {"thread_id": approval_id}}
snapshot = graph.get_state(config)

1. COMPLETED already? (snapshot exists, no snapshot.next, RemediationResult present)
   → return the CACHED result. Executor NOT called again.        # idempotent replay
2. FRESH? (no snapshot) → graph.invoke({approval_id, review_id, command}, config)
   → runs request_approval → interrupt() → SUSPENDS.
3. SUSPENDED (pending interrupt)? → graph.invoke(Command(resume={"approved": True}), config)
   → apply_command runs executor exactly once → incorporate → END.
4. Read final state → RemediationResult → map to response.
```

The checkpointer **is** the idempotency ledger. A crash between apply and END resumes *after*
the recorded apply node — never re-running the command (durable saver).

### Executor semantics — retryable vs terminal

- Executor **ran** the command (`ran=True`): terminal, **latched** regardless of exit code.
  Command already executed → must never re-run.
  - `exit_code == 0` → `{status:"applied", detail:<stdout summary>, resumedRunId}`
  - `exit_code != 0` → `{status:"failed", detail:<stderr>, resumedRunId}`
- Executor **could not run** (raised, e.g. infra unreachable / creds missing): **not latched**,
  nothing applied → endpoint returns **HTTP 503** so BullMQ retries safely. (The 200 JSON body
  stays exactly per contract; transient failures surface as non-200. This is the one
  contract-adjacent nuance, approved by PM.)

### HITL moat

`apply_and_resume` performs the apply **only** on the resume path — i.e. only when driven by a
job that originated from an EXECUTED `ApprovalPrompt` (webhook's `executeApproval` is the sole
enqueuer, gated on approval). The endpoint never auto-applies without an approved job; there is
no code path that runs a command outside the resume of an approval-seeded thread.

### `request_infrastructure_approval` (truthful, no cross-lane writes)

Replace the fake string with a truthful sentinel: `"Suspended: awaiting human approval to run
<command>. Reason: <reason>."` built via `build_approval_request(command, reason) ->
ApprovalRequest`. The tool does **not** call `interrupt()` itself (only valid inside a
checkpointed graph; rewiring `/review` is deferred). No `ApprovalPrompt` DB row is written here
— that remains the webhook's job.

## Testing (TDD — failing test first), against `InMemorySaver` + `MockCommandExecutor`

1. Graph suspends at `interrupt` before apply — executor NOT called until resume.
2. Fresh apply (exit 0) → `applied`, executor called once, `resumedRunId` set, stdout in detail.
3. **Idempotent replay** — same `approvalId` twice → executor called **once**, cached result returned.
4. Command ran non-zero → `failed`, latched; a second call does NOT re-run the executor.
5. Executor raised (couldn't run) → surfaced as retryable (503), not latched.
6. Endpoint (`POST /approvals/apply` via FastAPI `TestClient`) maps body → response shape.
7. `request_infrastructure_approval` no longer returns "Resuming"; returns truthful sentinel.

## Honest deferrals (a deployed env MUST verify)

- `InMemorySaver` is per-process. Deploy needs a **durable checkpointer** (Postgres/Redis
  saver) for cross-restart idempotency & resume.
- True *same original `/review` run* resume needs the Option-A schema field (`threadId` on
  `ApprovalPrompt`) + a checkpointed review path — **Eng1/PM lane**, out of scope here.
- `SubprocessCommandExecutor` against real AWS/kubectl is untested in-sandbox; deploy must
  verify with least-privilege credentials and confirm real stdout/exit-code capture.

## Out of scope

- `auto_resolver.py` (cross-lane GitHub/DB; PM scoped OUT this wave).
- Any `@arete/db` schema, `packages/webhook`, `packages/dashboard` change.
- Modifying the fixed contract.
