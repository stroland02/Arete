# Healing Loop v1 — Eng4 Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the healing loop per the frozen spec `docs/superpowers/specs/2026-07-19-healing-loop-design.md` — the fix route births a real `detecting` container and dispatches a real fix run; the worker advances real state transitions with the patch attached; failures surface honestly and the item returns to `open`.

**Architecture:** Webhook-service topology mirroring review/scan: dashboard fix route (session-scoped) → webhook `POST /fix/trigger` (bearer-guarded, `{workItemId}` only) → BullMQ `fix-workitem` queue → fix worker calls agents `POST /fix` (Eng3, frozen §3 contract, injected in tests) and persists each container transition + transcript incrementally. New terminal `fix_failed` state; `transcript` column on IssueContainer; `fixError` on WorkItem; stream/approve routes resolve stored containers so real transitions render (no sample).

**Tech Stack:** Next.js 16 route handlers (vitest, `renderToStaticMarkup` string assertions), Express + BullMQ + ioredis (webhook, vitest), Prisma 7.8/Postgres (shared dev DB — `migrate dev`, NEVER reset).

## Global Constraints

- Tenancy: every query scoped by `installationId`; cross-tenant reads are 404/no-op. Client-supplied installation ids are never trusted.
- HITL moat: the worker never advances past `ready`; only the human approve sets `solution_approved`; only human Send posts. Gates are never stamped by this lane.
- Anti-fabrication: `patch` non-empty **iff** `status:"fixed"` (double-checked worker-side even though agents enforces it); reasons are honest and user-renderable; nothing synthesized.
- Wire contract §3 is FROZEN: camelCase fields, `repo.token` = webhook-minted installation token, 300s timeout → `fix_failed`/`reason:"timeout"`.
- `/fix/trigger` mounts under Eng1's `createInternalAuthMiddleware()` bearer guard (`INTERNAL_API_TOKEN`, fail-closed 503).
- Shared dev DB (docker infra-postgres-1): apply migration with `pnpm --filter @arete/db exec prisma migrate dev`; never `migrate reset`.
- Existing WorkItem hooks (approve→`staged`, send→`posted`) and states are unchanged; NEW lifecycle edge: `fixing → open` on failure with reason surfaced.
- Secrets: the minted token rides only the server-to-server §3 call; never logged, never persisted, never returned to the browser.
- One commit per task, TDD (RED → GREEN → commit).

---

### Task 1: `fix_failed` — pipeline union + transitions + terminal replay

**Files:**
- Modify: `packages/dashboard/src/lib/issue-pipeline/types.ts` (ContainerState union)
- Modify: `packages/dashboard/src/lib/issue-pipeline/pipeline.ts` (TRANSITIONS map)
- Modify: `packages/dashboard/src/lib/issue-pipeline/container-store.ts` (TERMINAL_STATES set)
- Test: `packages/dashboard/src/lib/issue-pipeline/pipeline.test.ts` (append describe block)

**Interfaces:**
- Consumes: existing `canTransition`, `canApprove`, `canPost` from `pipeline.ts`.
- Produces: `ContainerState` now includes `"fix_failed"` (terminal; reachable from `detecting | fanning_out | verifying | composing`; never approvable/postable). Tasks 3, 5, 7 rely on the literal string `"fix_failed"`.

- [ ] **Step 1: Write the failing test** — append to `pipeline.test.ts`:

```ts
describe("fix_failed (healing loop v1)", () => {
  it("is reachable from every worker stage and terminal", () => {
    expect(canTransition("detecting", "fix_failed")).toBe(true);
    expect(canTransition("fanning_out", "fix_failed")).toBe(true);
    expect(canTransition("verifying", "fix_failed")).toBe(true);
    expect(canTransition("composing", "fix_failed")).toBe(true);
    expect(canTransition("ready", "fix_failed")).toBe(false);
    expect(canTransition("fix_failed", "ready")).toBe(false);
    expect(canTransition("fix_failed", "dismissed")).toBe(false);
  });

  it("can never be approved or posted", () => {
    const failed = {
      state: "fix_failed",
      gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
    } as unknown as IssueContainer;
    expect(canApprove(failed)).toBe(false);
    expect(canPost(failed)).toBe(false);
  });
});
```

(Reuse the file's existing imports; add `canApprove`, `canPost`, `IssueContainer` to them if not yet imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter dashboard exec vitest run src/lib/issue-pipeline/pipeline.test.ts`
Expected: FAIL — TS/type error `"fix_failed"` not assignable to `ContainerState` (or `canTransition` returns false).

- [ ] **Step 3: Minimal implementation**

`types.ts` — extend the union (after `"dismissed"`):

```ts
export type ContainerState =
  | "detecting"
  | "fanning_out"
  | "verifying"
  | "composing"
  | "ready"
  | "solution_approved"
  | "posted"
  | "changes_requested"
  | "merged"
  | "dismissed"
  | "fix_failed";
```

`pipeline.ts` — TRANSITIONS becomes:

```ts
const TRANSITIONS: Record<ContainerState, ReadonlyArray<ContainerState>> = {
  detecting: ["fanning_out", "dismissed", "fix_failed"],
  fanning_out: ["verifying", "dismissed", "fix_failed"],
  verifying: ["composing", "dismissed", "fix_failed"],
  composing: ["ready", "dismissed", "fix_failed"],
  ready: ["solution_approved", "dismissed"],
  solution_approved: ["posted", "changes_requested", "dismissed"],
  changes_requested: ["fanning_out", "dismissed"],
  posted: ["merged", "dismissed"],
  merged: [],
  dismissed: [],
  fix_failed: [],
};
```

`container-store.ts` — add `"fix_failed",` to `TERMINAL_STATES` (a failed run's transcript is history: replayed instantly, never paced as live).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter dashboard exec vitest run src/lib/issue-pipeline/`
Expected: PASS (all pipeline suites — the widened union must not break driver/persist-drive tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/issue-pipeline/types.ts packages/dashboard/src/lib/issue-pipeline/pipeline.ts packages/dashboard/src/lib/issue-pipeline/container-store.ts packages/dashboard/src/lib/issue-pipeline/pipeline.test.ts
git commit -m "feat(pipeline): fix_failed terminal state — reachable from worker stages, never approvable"
```

**Checkpoint note (do not skip):** flag the `ContainerState` extension for Eng2 ack in the handoff report (spec §8).

---

### Task 2: Schema — `IssueContainer.transcript Json?` + `WorkItem.fixError String?`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (IssueContainer ~line 111, WorkItem ~line 139)
- Create: `packages/db/prisma/migrations/20260719120000_add_container_transcript_work_item_fix_error/migration.sql`

**Interfaces:**
- Produces: nullable `transcript` (Json) on IssueContainer — ordered SynthStep[] written incrementally by the fix worker (Task 5), read by the stream route (Task 7). Nullable `fixError` (String) on WorkItem — honest failure reason read by the inbox (Task 6), cleared by the fix route (Task 3).

- [ ] **Step 1: Schema edits** — inside `model IssueContainer` after `findings`:

```prisma
  /// Ordered SynthStep[] transcript of the real fix drive (healing-loop v1
  /// spec §4). Written on each incremental worker save; read by the stream
  /// route for honest replay. Null for pre-healing-loop rows.
  transcript     Json?
```

Inside `model WorkItem` after `scanRunId`:

```prisma
  /// Honest reason the last fix attempt failed (fix_failed/escalation, spec
  /// §7) — rendered in the panel while the item is back at `open`. Cleared
  /// when a new fix run starts.
  fixError       String?
```

- [ ] **Step 2: Migration SQL** — create the migration file:

```sql
-- Healing loop v1 (spec 2026-07-19 §4, §7): the real fix drive's transcript,
-- and the honest failure reason on the work item. Both nullable — additive.
ALTER TABLE "IssueContainer" ADD COLUMN "transcript" JSONB;
ALTER TABLE "WorkItem" ADD COLUMN "fixError" TEXT;
```

- [ ] **Step 3: Apply to the shared dev DB** (env from the main-tree `.env`; NEVER reset):

Run: `pnpm --filter @arete/db exec prisma migrate dev --name add_container_transcript_work_item_fix_error`
Expected: "Your database is now in sync with your schema." then client regeneration. Verify with `prisma migrate status` → "Database schema is up to date".

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260719120000_add_container_transcript_work_item_fix_error/migration.sql
git commit -m "feat(db): IssueContainer.transcript + WorkItem.fixError — healing-loop columns"
```

**Checkpoint note:** list both columns as schema coordination with Eng1 (checkpoint-deps rule); integration needs `prisma migrate deploy` + client regeneration.

---

### Task 3: Fix-route correction — real `detecting` container + dispatch

**Files:**
- Modify: `packages/dashboard/src/app/api/work-items/[id]/fix/route.ts`
- Test: `packages/dashboard/src/app/api/work-items/work-item-triage.test.ts` (existing harness: `vi.hoisted` fakes of `@/lib/db` + `@/lib/model-connections-api`)

**Interfaces:**
- Consumes: `internalAuthHeaders()` from `@/lib/internal-auth`; env `WEBHOOK_SERVICE_URL`; `"fix_failed"` literal (Task 1); `fixError` column (Task 2).
- Produces: containers born `{ state: 'detecting', gates: {4-field null shape}, transcript: [] }`; `POST ${WEBHOOK_SERVICE_URL}/fix/trigger` with body `{ workItemId }`; honest revert (`container → fix_failed`, `item → open + fixError`, HTTP 502) when dispatch fails. Task 4's handler receives exactly `{ workItemId: string }`.

- [ ] **Step 1: Write the failing tests** — add to the triage suite (using its existing fakeDb/scope mocks):

```ts
describe('POST /fix — healing loop dispatch', () => {
  beforeEach(() => {
    process.env.WEBHOOK_SERVICE_URL = 'http://wh.test';
    process.env.INTERNAL_API_TOKEN = 'tok-internal';
  });

  it('births the container at detecting with full gates and an empty transcript, then dispatches the trigger', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ enqueued: true }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(new Request('http://x'), { params: Promise.resolve({ id: 'wi-1' }) });
    expect(res.status).toBe(200);

    const created = fakeDb.issueContainer.create.mock.calls[0][0].data;
    expect(created.state).toBe('detecting');
    expect(created.gates).toEqual({ solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null });
    expect(created.transcript).toEqual([]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://wh.test/fix/trigger');
    expect(init.headers.authorization).toBe('Bearer tok-internal');
    expect(JSON.parse(init.body)).toEqual({ workItemId: 'wi-1' });
  });

  it('reverts honestly when the trigger is unreachable: item back to open with the reason, container fix_failed, 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const res = await POST(new Request('http://x'), { params: Promise.resolve({ id: 'wi-1' }) });
    expect(res.status).toBe(502);

    expect(fakeDb.issueContainer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'fix_failed' }) }),
    );
    const lastItemUpdate = fakeDb.workItem.update.mock.calls.at(-1)[0];
    expect(lastItemUpdate.data.state).toBe('open');
    expect(typeof lastItemUpdate.data.fixError).toBe('string');
  });

  it('clears a previous fixError when a retry starts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 202 })));
    await POST(new Request('http://x'), { params: Promise.resolve({ id: 'wi-1' }) });
    const firstItemUpdate = fakeDb.workItem.update.mock.calls[0][0];
    expect(firstItemUpdate.data).toMatchObject({ state: 'fixing', fixError: null });
  });
});
```

(Adapt fake wiring to the file's existing `fakeDb` shape — it must gain `issueContainer.updateMany` if absent.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter dashboard exec vitest run src/app/api/work-items/work-item-triage.test.ts`
Expected: FAIL — created state is `'open'`, no fetch performed.

- [ ] **Step 3: Implement** — rewrite the mutation half of `route.ts` (tenancy/409/no_repo checks unchanged):

```ts
  const branch = `kuma/${item.kind}-${item.id.slice(0, 8)}`;
  // Born at the pipeline's REAL initial state (spec §4) — never 'open'. The
  // worker advances it; gates start fully null (HITL moat untouched).
  const container = await db.issueContainer.create({
    data: {
      installationId: item.installationId,
      state: 'detecting',
      gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
      target,
      pr: { base: 'main', branch, title: item.title, body: item.detail },
      patch: [],
      findings: item.evidence ?? [],
      transcript: [],
    },
  });

  await db.workItem.update({
    where: { id: item.id },
    data: { state: 'fixing', containerId: container.id, fixError: null },
  });

  // Dispatch the real fix run (spec §2): webhook /fix/trigger, bearer-guarded,
  // body carries ONLY the work-item id — the webhook re-derives tenancy from
  // the row. A failed dispatch reverts honestly: no phantom "fixing" items.
  let dispatched = false;
  const base = process.env.WEBHOOK_SERVICE_URL;
  if (base) {
    try {
      const res = await fetch(`${base}/fix/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
        body: JSON.stringify({ workItemId: item.id }),
      });
      dispatched = res.status === 202;
    } catch {
      dispatched = false;
    }
  }
  if (!dispatched) {
    await db.issueContainer.updateMany({
      where: { id: container.id, installationId: item.installationId },
      data: { state: 'fix_failed' },
    });
    await db.workItem.update({
      where: { id: item.id },
      data: { state: 'open', fixError: 'Fix dispatch failed — the fix service is unreachable. Retry when it is back.' },
    });
    return NextResponse.json({ error: 'fix_dispatch_failed' }, { status: 502 });
  }

  return NextResponse.json({ containerId: container.id }, { status: 200 });
```

Add `import { internalAuthHeaders } from '@/lib/internal-auth';` at the top. Update the route's doc comment: it now creates a `detecting` container and dispatches the run.

- [ ] **Step 4: Run to verify pass** — same command as Step 2, then the full triage + work-items suites.
Expected: PASS (existing dismiss/tenancy tests untouched).

- [ ] **Step 5: Commit**

```bash
git add "packages/dashboard/src/app/api/work-items/[id]/fix/route.ts" packages/dashboard/src/app/api/work-items/work-item-triage.test.ts
git commit -m "feat(dashboard): fix route births real detecting containers and dispatches /fix/trigger"
```

---

### Task 4: Webhook `/fix/trigger` + `fix-workitem` queue

**Files:**
- Modify: `packages/webhook/src/queue.ts`
- Create: `packages/webhook/src/fix/trigger-handler.ts`
- Modify: `packages/webhook/src/server.ts` (mount after `/scan/trigger`, same guard)
- Test: `packages/webhook/src/fix/trigger-handler.test.ts`

**Interfaces:**
- Consumes: `createInternalAuthMiddleware` (already instantiated in server.ts as `requireInternalToken`); `{ workItemId }` body from Task 3.
- Produces: `FIX_QUEUE_NAME = 'fix-workitem'`, `interface FixJobData { workItemId: string }`, `enqueueFixJob(data)` — Task 5's worker consumes this queue. HTTP: 400 missing id / 404 unknown / 409 not-dispatchable / 202 enqueued.

- [ ] **Step 1: Write the failing tests** — `trigger-handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createFixTriggerHandler, type FixTriggerDeps } from './trigger-handler.js'

function call(handler: ReturnType<typeof createFixTriggerHandler>, body: unknown) {
  const req = { body } as never
  const res = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) { this.statusCode = code; return this },
    json(p: unknown) { this.payload = p; return this },
  }
  return (handler(req, res as never, vi.fn()) as Promise<void>).then(() => res)
}

describe('POST /fix/trigger handler', () => {
  const fixing = { id: 'wi-1', state: 'fixing', containerId: 'cont-1' }

  it('400s without a workItemId', async () => {
    const deps: FixTriggerDeps = { loadWorkItem: vi.fn(), enqueue: vi.fn() }
    const res = await call(createFixTriggerHandler(deps), {})
    expect(res.statusCode).toBe(400)
    expect(deps.enqueue).not.toHaveBeenCalled()
  })

  it('404s an unknown work item', async () => {
    const deps: FixTriggerDeps = { loadWorkItem: vi.fn(async () => null), enqueue: vi.fn() }
    const res = await call(createFixTriggerHandler(deps), { workItemId: 'nope' })
    expect(res.statusCode).toBe(404)
  })

  it('409s an item that is not mid-fix (state or container missing)', async () => {
    const deps: FixTriggerDeps = {
      loadWorkItem: vi.fn(async () => ({ id: 'wi-1', state: 'open', containerId: null })),
      enqueue: vi.fn(),
    }
    const res = await call(createFixTriggerHandler(deps), { workItemId: 'wi-1' })
    expect(res.statusCode).toBe(409)
    expect(deps.enqueue).not.toHaveBeenCalled()
  })

  it('202s and enqueues exactly { workItemId } for a fixing item', async () => {
    const deps: FixTriggerDeps = { loadWorkItem: vi.fn(async () => fixing), enqueue: vi.fn(async () => ({})) }
    const res = await call(createFixTriggerHandler(deps), { workItemId: 'wi-1' })
    expect(res.statusCode).toBe(202)
    expect(deps.enqueue).toHaveBeenCalledWith({ workItemId: 'wi-1' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @arete/webhook exec vitest run src/fix/trigger-handler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`queue.ts` additions (below the approval queue definitions, reusing `getConnection` + `DEFAULT_JOB_OPTIONS`):

```ts
// Healing-loop fix runs (spec 2026-07-19 §2). Separate queue for the same
// isolation reason as approval-exec: a review backlog must never delay a
// human-triggered fix, and vice-versa.
export const FIX_QUEUE_NAME = 'fix-workitem'

/** Payload for a fix job: ONLY the work-item id. The worker re-reads the row —
 *  tenancy and container identity are derived from the DB, never the caller. */
export interface FixJobData {
  workItemId: string
}
```

```ts
let queueFix: Queue<FixJobData> | null = null

export function getFixQueue(): Queue<FixJobData> {
  if (!queueFix) queueFix = new Queue<FixJobData>(FIX_QUEUE_NAME, { connection: getConnection() })
  return queueFix
}
```

```ts
/** Enqueues a healing-loop fix run. Durable retry/backoff like reviews, so a
 *  dispatched fix survives a worker restart. */
export async function enqueueFixJob(data: FixJobData) {
  return getFixQueue().add(FIX_QUEUE_NAME, data, DEFAULT_JOB_OPTIONS)
}
```

And in `closeReviewQueue`: `await queueFix?.close()` + `queueFix = null` alongside the others.

`fix/trigger-handler.ts`:

```ts
// The HTTP skin over fix-run dispatch (spec §2, §6). Internal endpoint under
// the shared bearer guard: the dashboard's session-scoped fix route calls it
// AFTER creating the container and marking the item `fixing`. The body carries
// ONLY workItemId — installation and container identity are re-derived from
// the stored row, so a forged body can never cross tenants.

import type { RequestHandler } from 'express'

export interface FixTriggerDeps {
  loadWorkItem(id: string): Promise<{ id: string; state: string; containerId: string | null } | null>
  enqueue(data: { workItemId: string }): Promise<unknown>
}

export function defaultFixTriggerDeps(): FixTriggerDeps {
  return {
    async loadWorkItem(id) {
      const { prisma } = await import('../db.js')
      return prisma.workItem.findUnique({
        where: { id },
        select: { id: true, state: true, containerId: true },
      })
    },
    async enqueue(data) {
      const { enqueueFixJob } = await import('../queue.js')
      return enqueueFixJob(data)
    },
  }
}

export function createFixTriggerHandler(deps: FixTriggerDeps = defaultFixTriggerDeps()): RequestHandler {
  return async (req, res) => {
    const workItemId = typeof req.body?.workItemId === 'string' ? req.body.workItemId : ''
    if (!workItemId) {
      res.status(400).json({ error: 'workItemId required' })
      return
    }
    try {
      const item = await deps.loadWorkItem(workItemId)
      if (!item) {
        res.status(404).json({ error: 'not_found' })
        return
      }
      // Only an item the fix route just put into `fixing` (with its container
      // created) is dispatchable — anything else is a stale or forged call.
      if (item.state !== 'fixing' || !item.containerId) {
        res.status(409).json({ error: 'not_dispatchable', state: item.state })
        return
      }
      await deps.enqueue({ workItemId })
      res.status(202).json({ enqueued: true })
    } catch (err) {
      console.error('[fix] trigger route failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  }
}
```

`server.ts` — directly after the `/scan/trigger` route:

```ts
  // Internal fix trigger (healing loop, spec §2/§6). The dashboard's
  // session-scoped POST /api/work-items/[id]/fix proxies here after creating
  // the detecting container. Body carries ONLY workItemId; tenancy is derived
  // from the stored row. Deps import lazily (db-free registration).
  const { createFixTriggerHandler } = await import('./fix/trigger-handler.js')
  server.post('/fix/trigger', requireInternalToken, express.json(), createFixTriggerHandler())
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/fix/ src/queue.test.ts src/internal-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/webhook/src/queue.ts packages/webhook/src/fix/trigger-handler.ts packages/webhook/src/fix/trigger-handler.test.ts packages/webhook/src/server.ts
git commit -m "feat(webhook): /fix/trigger + fix-workitem queue — bearer-guarded, workItemId-only"
```

---

### Task 5: Fix worker — incremental drive persistence + agents `POST /fix`

**Files:**
- Create: `packages/webhook/src/fix/run.ts`
- Create: `packages/webhook/src/fix/worker.ts`
- Modify: `packages/webhook/src/worker.ts` (entry block: start fix worker)
- Test: `packages/webhook/src/fix/run.test.ts`

**Interfaces:**
- Consumes: `FixJobData` (Task 4); `resolveModelConnectionForReview`/`defaultResolveModelDeps` + `LlmConfig` from `../resolve-model-connection.js`; `createApp`/`getInstallationToken` from `../github-auth.js`; `getServiceConfig().pythonServiceUrl`; columns from Task 2.
- Produces: `runFixJob({workItemId}, deps)` — never throws; persists container transitions `fanning_out → verifying → composing (patch attached) → ready` (success) or `→ fix_failed` + WorkItem `open`/`fixError` (failure/timeout). `FixRequestBody`/`FixResponseBody` mirror frozen §3 exactly. `startFixWorker()` consumes `fix-workitem`.

- [ ] **Step 1: Write the failing tests** — `run.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { runFixJob, type FixRunDeps, type FixResponseBody } from './run.js'

const ITEM = {
  id: 'wi-1', installationId: 'inst-1', kind: 'issue', title: 'SQL injection',
  detail: 'raw q into db.raw', dimension: 'security', confidence: 0.8,
  evidence: [{ path: 'app/api/reports.ts', line: 3 }], state: 'fixing', containerId: 'cont-1',
}
const FIXED: FixResponseBody = {
  status: 'fixed',
  patch: [{ path: 'app/api/reports.ts', content: 'parameterized()' }],
  transcript: [
    { agent: 'security', action: 'author', detail: 'Parameterized the query', report: { status: 'done', confidence: 0.9, blockers: [] } },
    { agent: 'security', action: 'verify', detail: 'Diff demonstrably fixes the issue' },
  ],
  verification: { verdict: 'verified', checks: ['auto_resolver'] },
}

function fakeDeps(response: () => Promise<FixResponseBody>, item: Record<string, unknown> = ITEM) {
  const containerSaves: Array<{ state: string; transcript: unknown[]; patch?: unknown }> = []
  const itemUpdates: Array<Record<string, unknown>> = []
  const deps: FixRunDeps = {
    prisma: {
      workItem: {
        findUnique: vi.fn(async () => item as never),
        update: vi.fn(async (args: { data: Record<string, unknown> }) => { itemUpdates.push(args.data); return {} }),
      },
      issueContainer: {
        findFirst: vi.fn(async () => ({ id: 'cont-1', state: 'detecting', pr: { base: 'main' } })),
        updateMany: vi.fn(async (args: { data: { state: string; transcript: unknown[]; patch?: unknown } }) => {
          containerSaves.push(structuredClone(args.data)); return { count: 1 }
        }),
      },
      installation: { findUnique: vi.fn(async () => ({ id: 'inst-1', externalId: 42 })) },
      repository: { findFirst: vi.fn(async () => ({ fullName: 'acme/api' })) },
    },
    resolveModel: vi.fn(async () => ({ provider: 'ollama', model: 'qwen2.5-coder' }) as never),
    mintToken: vi.fn(async () => 'ghs_tok'),
    fetchFix: vi.fn(response),
    now: () => '2026-07-19T00:00:00.000Z',
  }
  return { deps, containerSaves, itemUpdates }
}

describe('runFixJob', () => {
  it('advances fanning_out → verifying → composing (patch attached) → ready, and leaves the item fixing', async () => {
    const { deps, containerSaves, itemUpdates } = fakeDeps(async () => FIXED)
    await runFixJob({ workItemId: 'wi-1' }, deps)

    expect(containerSaves.map((s) => s.state)).toEqual(['fanning_out', 'verifying', 'composing', 'ready'])
    const composing = containerSaves[2]
    expect(composing.patch).toEqual(FIXED.patch)
    // transcript grows monotonically and carries the agents report through
    expect(containerSaves[3].transcript.length).toBeGreaterThan(containerSaves[0].transcript.length)
    expect(JSON.stringify(containerSaves[3].transcript)).toContain('"confidence":0.9')
    // HITL moat: worker never touches the WorkItem on success
    expect(itemUpdates).toEqual([])
  })

  it('sends the frozen §3 request shape (token, defaultBranch from pr.base, full item payload)', async () => {
    const { deps } = fakeDeps(async () => FIXED)
    await runFixJob({ workItemId: 'wi-1' }, deps)
    const body = (deps.fetchFix as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(body).toMatchObject({
      containerId: 'cont-1',
      installationId: 'inst-1',
      repo: { fullName: 'acme/api', defaultBranch: 'main', token: 'ghs_tok' },
      item: { kind: 'issue', title: 'SQL injection', dimension: 'security', confidence: 0.8 },
    })
    expect(body.llm).toBeDefined()
  })

  it('fix_failed: container terminal with the reason in the transcript; item back to open with fixError', async () => {
    const { deps, containerSaves, itemUpdates } = fakeDeps(async () => ({
      status: 'fix_failed', reason: 'verification failed: issue still present', patch: [], transcript: [],
    }))
    await runFixJob({ workItemId: 'wi-1' }, deps)

    expect(containerSaves.at(-1)?.state).toBe('fix_failed')
    expect(JSON.stringify(containerSaves.at(-1)?.transcript)).toContain('verification failed')
    expect(itemUpdates.at(-1)).toMatchObject({ state: 'open', fixError: 'verification failed: issue still present' })
  })

  it('grounding double-check: "fixed" with an empty patch is treated as a failure, never staged', async () => {
    const { deps, containerSaves } = fakeDeps(async () => ({ ...FIXED, patch: [] }))
    await runFixJob({ workItemId: 'wi-1' }, deps)
    expect(containerSaves.map((s) => s.state)).not.toContain('ready')
    expect(containerSaves.at(-1)?.state).toBe('fix_failed')
  })

  it('timeout: AbortError becomes fix_failed with reason "timeout"', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const { deps, itemUpdates } = fakeDeps(async () => { throw abort })
    await runFixJob({ workItemId: 'wi-1' }, deps)
    expect(itemUpdates.at(-1)).toMatchObject({ state: 'open', fixError: 'timeout' })
  })

  it('a stale job (item no longer fixing) is a silent no-op', async () => {
    const { deps, containerSaves, itemUpdates } = fakeDeps(async () => FIXED, { ...ITEM, state: 'open' })
    await runFixJob({ workItemId: 'wi-1' }, deps)
    expect(containerSaves).toEqual([])
    expect(itemUpdates).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @arete/webhook exec vitest run src/fix/run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `run.ts`**

```ts
// The healing-loop fix run (spec 2026-07-19 §2–§4): consume one fix-workitem
// job, call agents POST /fix (frozen §3 wire contract), and advance the
// IssueContainer through REAL state transitions — persisting state + transcript
// on each one, so the stream route replays honest progress. Success parks the
// container at `ready` (HITL moat: the human approve/send gates are untouched);
// any failure is terminal `fix_failed` with the WorkItem honestly back at
// `open` + fixError. Never throws: a fix run's outcome is always recorded, and
// a BullMQ retry of a recorded failure would re-run a whole LLM fix for free.

import type { LlmConfig } from '../resolve-model-connection.js'

export const FIX_TIMEOUT_MS = 300_000

export interface FixEvidenceRef {
  path: string
  line: number
  excerpt?: string | null
}

/** Frozen §3 request. camelCase on the wire; repo.token is webhook-minted. */
export interface FixRequestBody {
  containerId: string
  installationId: string
  repo: { fullName: string; defaultBranch: string; token: string }
  item: {
    kind: string
    title: string
    detail: string
    dimension: string
    confidence: number
    evidence: FixEvidenceRef[]
  }
  llm: LlmConfig
}

export interface FixTranscriptEntry {
  agent: string
  action: 'author' | 'verify' | 'compose'
  detail: string
  report?: { status: 'done' | 'blocked'; confidence: number; blockers: string[] }
}

/** Frozen §3 response. patch non-empty iff status === "fixed". */
export interface FixResponseBody {
  status: 'fixed' | 'fix_failed'
  reason?: string
  patch: { path: string; content: string }[]
  transcript: FixTranscriptEntry[]
  verification?: { verdict: 'verified' | 'unverified'; checks: string[] }
}

/** SynthStep-shaped transcript record (dashboard types.ts is out of package —
 *  same JSON shape, structurally). */
interface StepRecord {
  kind: 'dispatch' | 'report' | 'verify' | 'compose' | 'drop' | 'posted'
  agentId?: string
  text: string
  detail?: string
  at: string
  report?: unknown
}

export interface FixRunDeps {
  prisma: {
    workItem: {
      findUnique(args: unknown): Promise<{
        id: string; installationId: string; kind: string; title: string
        detail: string; dimension: string; confidence: number; evidence: unknown
        state: string; containerId: string | null
      } | null>
      update(args: unknown): Promise<unknown>
    }
    issueContainer: {
      findFirst(args: unknown): Promise<{ id: string; state: string; pr: unknown } | null>
      updateMany(args: unknown): Promise<{ count: number }>
    }
    installation: { findUnique(args: unknown): Promise<{ id: string; externalId: number } | null> }
    repository: { findFirst(args: unknown): Promise<{ fullName: string } | null> }
  }
  resolveModel(externalInstallationId: number): Promise<LlmConfig | undefined>
  mintToken(externalInstallationId: number): Promise<string>
  fetchFix(body: FixRequestBody): Promise<FixResponseBody>
  now?: () => string
}

export async function runFixJob(
  data: { workItemId: string },
  deps: FixRunDeps = defaultFixRunDeps(),
): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString())

  const item = await deps.prisma.workItem.findUnique({ where: { id: data.workItemId } })
  // Stale/forged job — the row moved on. Nothing honest to record.
  if (!item || item.state !== 'fixing' || !item.containerId) return

  const containerId = item.containerId
  const installationId = item.installationId
  const steps: StepRecord[] = []

  const persist = (state: string, extra: Record<string, unknown> = {}) =>
    deps.prisma.issueContainer.updateMany({
      where: { id: containerId, installationId },
      data: { state, transcript: steps, ...extra },
    })

  const fail = async (reason: string) => {
    steps.push({ kind: 'drop', text: 'Fix failed', detail: reason, at: now() })
    await persist('fix_failed')
    await deps.prisma.workItem.update({
      where: { id: item.id },
      data: { state: 'open', fixError: reason },
    })
  }

  try {
    const container = await deps.prisma.issueContainer.findFirst({
      where: { id: containerId, installationId },
    })
    if (!container) {
      await fail('fix run could not load its container')
      return
    }
    const installation = await deps.prisma.installation.findUnique({
      where: { id: installationId },
      select: { id: true, externalId: true },
    })
    const repo = await deps.prisma.repository.findFirst({
      where: { installationId },
      orderBy: { createdAt: 'asc' },
      select: { fullName: true },
    })
    if (!installation || !repo) {
      await fail('no connected repository for this fix')
      return
    }
    const llm = await deps.resolveModel(installation.externalId)
    if (!llm) {
      await fail('no connected model — connect one and retry')
      return
    }

    steps.push({
      kind: 'dispatch',
      text: 'Fix author dispatched',
      detail: `${item.dimension} · ${item.title}`,
      at: now(),
    })
    await persist('fanning_out')

    const token = await deps.mintToken(installation.externalId)
    const pr = (container.pr ?? {}) as { base?: string }
    const response = await deps.fetchFix({
      containerId,
      installationId,
      repo: { fullName: repo.fullName, defaultBranch: pr.base ?? 'main', token },
      item: {
        kind: item.kind,
        title: item.title,
        detail: item.detail,
        dimension: item.dimension,
        confidence: item.confidence,
        evidence: (Array.isArray(item.evidence) ? item.evidence : []) as FixEvidenceRef[],
      },
      llm,
    })

    // The agents transcript rides into ours — real per-stage reports, never
    // synthesized. author → report (provenance = the authoring agent).
    for (const t of response.transcript ?? []) {
      const kind = t.action === 'verify' ? 'verify' : t.action === 'compose' ? 'compose' : 'report'
      steps.push({
        kind,
        agentId: t.agent,
        text: t.detail,
        at: now(),
        ...(t.report ? { report: t.report } : {}),
      })
    }
    await persist('verifying')

    // Deterministic double-check of the §3 grounding contract ("patch
    // non-empty iff fixed") — a violating response is a failure, never staged.
    if (response.status !== 'fixed' || !Array.isArray(response.patch) || response.patch.length === 0) {
      await fail(response.reason ?? 'fix author returned no verified patch')
      return
    }

    steps.push({
      kind: 'compose',
      text: `Patch composed — ${response.patch.length} file${response.patch.length === 1 ? '' : 's'}`,
      at: now(),
    })
    await persist('composing', { patch: response.patch })

    steps.push({ kind: 'posted', text: 'Fix staged — ready for your approval', at: now() })
    await persist('ready')
    // WorkItem stays `fixing` — the human approve hook moves it to `staged`.
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'AbortError'
        ? 'timeout'
        : 'fix run failed — the fix service was unreachable or errored'
    console.error(`[fix-worker] run for work item ${data.workItemId} failed:`, err)
    try {
      await fail(reason)
    } catch (persistErr) {
      console.error(`[fix-worker] could not record failure for ${data.workItemId}:`, persistErr)
    }
  }
}

export function defaultFixRunDeps(): FixRunDeps {
  const db = () => import('../db.js').then((m) => m.prisma)
  return {
    prisma: {
      workItem: {
        findUnique: async (args) => (await db()).workItem.findUnique(args as never),
        update: async (args) => (await db()).workItem.update(args as never),
      },
      issueContainer: {
        findFirst: async (args) => (await db()).issueContainer.findFirst(args as never),
        updateMany: async (args) => (await db()).issueContainer.updateMany(args as never),
      },
      installation: {
        findUnique: async (args) => (await db()).installation.findUnique(args as never),
      },
      repository: {
        findFirst: async (args) => (await db()).repository.findFirst(args as never),
      },
    },
    async resolveModel(externalInstallationId) {
      const { resolveModelConnectionForReview, defaultResolveModelDeps } = await import(
        '../resolve-model-connection.js'
      )
      return resolveModelConnectionForReview(externalInstallationId, defaultResolveModelDeps())
    },
    async mintToken(externalInstallationId) {
      const { createApp, getInstallationToken } = await import('../github-auth.js')
      return getInstallationToken(await createApp(), externalInstallationId)
    },
    async fetchFix(body) {
      const { getServiceConfig } = await import('../config.js')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FIX_TIMEOUT_MS)
      try {
        const res = await fetch(`${getServiceConfig().pythonServiceUrl}/fix`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`/fix returned ${res.status}`)
        return (await res.json()) as FixResponseBody
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
```

(Verify the exact `resolveModelConnectionForReview` and `createApp` call signatures against `scan/trigger.ts`'s `defaultScanTriggerDeps` and `github-auth.ts` while implementing — mirror whatever those export; scan's default deps are the source of truth for the model-resolution call.)

`fix/worker.ts`:

```ts
import { Worker } from 'bullmq'
import { Redis as IORedis } from 'ioredis'
import { FIX_QUEUE_NAME, type FixJobData } from '../queue.js'
import { runFixJob } from './run.js'

// Low concurrency: each run is a full LLM authoring pass on the agents service.
export const FIX_QUEUE_CONCURRENCY = 2

/** Start the BullMQ worker on the fix-workitem queue. Mirrors
 *  startApprovalWorker; runFixJob records every outcome itself (never throws),
 *  so BullMQ-level retries only cover crashes before the run recorded anything. */
export function startFixWorker(): Worker<FixJobData> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })
  return new Worker<FixJobData>(
    FIX_QUEUE_NAME,
    async (job) => {
      await runFixJob(job.data)
    },
    { connection, concurrency: FIX_QUEUE_CONCURRENCY },
  )
}
```

`worker.ts` entry block — after `startApprovalWorker()`:

```ts
  // Also consume the healing-loop fix queue (work-item Fix it → agents /fix).
  console.log('Areté fix worker starting...')
  startFixWorker()
```

with `import { startFixWorker } from './fix/worker.js'` alongside the approval-worker import.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @arete/webhook exec vitest run src/fix/`
Expected: PASS (6 run tests + 4 trigger tests).

- [ ] **Step 5: Commit**

```bash
git add packages/webhook/src/fix/run.ts packages/webhook/src/fix/run.test.ts packages/webhook/src/fix/worker.ts packages/webhook/src/worker.ts
git commit -m "feat(webhook): fix worker — incremental drive persistence + agents /fix per frozen contract"
```

---

### Task 6: Inbox surfacing — `fixError` reason line + retry

**Files:**
- Modify: `packages/dashboard/src/lib/work-items.ts`
- Modify: `packages/dashboard/src/components/dashboard/services/services-workspace.tsx` (WorkItemPanel)
- Test: `packages/dashboard/src/lib/work-items.test.ts`, `packages/dashboard/src/components/dashboard/services/services-workspace.test.tsx`

**Interfaces:**
- Consumes: `fixError` column (Task 2).
- Produces: `WorkItemView.fixError?: string | null`; the panel renders `Fix failed: <reason>` on an `open` item carrying one — the existing Fix it button doubles as the retry.

- [ ] **Step 1: Write the failing tests**

`work-items.test.ts` — add (reusing the file's existing fake-db fixture pattern):

```ts
it('carries the honest fixError through to the view', async () => {
  const db = fakeInboxDb([
    row({ id: 'wi-9', state: 'open', fixError: 'timeout' }),
  ]);
  const inbox = await getWorkItemInbox(db, ['inst-1']);
  expect(inbox.items[0].fixError).toBe('timeout');
});
```

(`fakeInboxDb`/`row` = the file's existing fixtures — use their actual names; extend the row factory so `fixError` passes through.)

`services-workspace.test.tsx` — add to the state-matrix describe:

```tsx
it('state matrix: an open item with a failed fix shows the honest reason and still offers Fix it (retry)', () => {
  const html = renderToStaticMarkup(
    <WorkItemPanel item={item({ fixError: 'verification failed: issue still present' })} />,
  );
  expect(html).toContain('Fix failed');
  expect(html).toContain('verification failed: issue still present');
  expect(html).toContain('Fix it');
});
```

(Add `fixError: null` to the test's `item()` factory defaults.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter dashboard exec vitest run src/lib/work-items.test.ts src/components/dashboard/services/services-workspace.test.tsx`
Expected: FAIL — `fixError` undefined / reason not rendered.

- [ ] **Step 3: Implement**

`work-items.ts` — in `WorkItemView`:

```ts
  /** Honest reason the last fix attempt failed — shown while back at `open`. */
  fixError?: string | null;
```

and in the row mapping: `fixError: (r.fixError ?? null) as string | null,`

`services-workspace.tsx` — in `WorkItemPanel`, directly after the Evidence `PanelSection`:

```tsx
          {item.state === "open" && item.fixError ? (
            <PanelSection title="Last fix attempt">
              <p className="px-1 text-[11px] leading-5 text-content-secondary">
                Fix failed: {item.fixError}
              </p>
              <p className="px-1 pt-1 text-[11px] leading-5 text-content-muted">
                The item is back in the inbox — Fix it again to retry.
              </p>
            </PanelSection>
          ) : null}
```

(Match the failed-scan line's styling classes if they differ — reuse whatever `scanStatusLine`'s failure branch uses for its error text.)

- [ ] **Step 4: Run to verify pass** — same command as Step 2; then the full services-workspace suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/work-items.ts packages/dashboard/src/lib/work-items.test.ts packages/dashboard/src/components/dashboard/services/services-workspace.tsx packages/dashboard/src/components/dashboard/services/services-workspace.test.tsx
git commit -m "feat(services): surface fix failures honestly — reason line + retry on open items"
```

---

### Task 7: Stored-container resolution — real transitions in stream + approve

**Files:**
- Create: `packages/dashboard/src/lib/issue-pipeline/stored-container.ts`
- Modify: `packages/dashboard/src/app/api/containers/[id]/stream/route.ts`
- Modify: `packages/dashboard/src/app/api/containers/[id]/approve/route.ts`
- Test: `packages/dashboard/src/lib/issue-pipeline/stored-container.test.ts`

**Interfaces:**
- Consumes: `transcript` column (Task 2); domain types from `./types`; `InMemoryContainerStore` terminal handling (Task 1 added `fix_failed`).
- Produces: `getStoredContainer(db, installationIds, id): Promise<IssueContainer | null>` — tenancy-scoped projection of a persisted row (real transcript, real state, honest neutral constants for fields the row does not carry, nothing fabricated as a finding). Resolution order in both routes becomes: review-projection → stored row → sample.

- [ ] **Step 1: Write the failing tests** — `stored-container.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { getStoredContainer } from './stored-container'

const ROW = {
  id: 'cont-1',
  installationId: 'inst-1',
  state: 'verifying',
  gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
  target: { owner: 'acme', repo: 'api' },
  pr: { base: 'main', branch: 'kuma/issue-wi1', title: 'Fix SQL injection', body: 'details' },
  patch: [],
  findings: [],
  transcript: [{ kind: 'dispatch', text: 'Fix author dispatched', at: '2026-07-19T00:00:00.000Z' }],
  createdAt: new Date('2026-07-19T00:00:00.000Z'),
  updatedAt: new Date('2026-07-19T00:01:00.000Z'),
}

function dbWith(row: unknown) {
  return { issueContainer: { findFirst: vi.fn(async () => row) } }
}

describe('getStoredContainer', () => {
  it('projects a stored fix container with its REAL transcript and state', async () => {
    const c = await getStoredContainer(dbWith(ROW), ['inst-1'], 'cont-1')
    expect(c?.state).toBe('verifying')
    expect(c?.transcript).toEqual(ROW.transcript)
    expect(c?.pr?.title).toBe('Fix SQL injection')
    expect(c?.serviceId).toBe('acme/api')
    // nothing fabricated: no findings invented from the row
    expect(c?.findings).toEqual([])
  })

  it('always scopes by installation — an empty scope never queries', async () => {
    const db = dbWith(ROW)
    expect(await getStoredContainer(db, [], 'cont-1')).toBeNull()
    expect(db.issueContainer.findFirst).not.toHaveBeenCalled()
  })

  it('returns null for a miss or a row whose state is not a pipeline state', async () => {
    expect(await getStoredContainer(dbWith(null), ['inst-1'], 'x')).toBeNull()
    expect(await getStoredContainer(dbWith({ ...ROW, state: 'open' }), ['inst-1'], 'cont-1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter dashboard exec vitest run src/lib/issue-pipeline/stored-container.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `stored-container.ts`**

```ts
// Projection of a PERSISTED IssueContainer row (the fix worker's writes) into
// the domain IssueContainer the console/stream/approve paths consume. The row
// stores exactly what the healing loop recorded — state, gates, target, pr,
// patch, findings, transcript. Fields the row does not carry get honest
// neutral constants (never fabricated findings/severity theater). Legacy
// 'open' rows (pre-healing-loop) are not pipeline states → null, so callers
// fall through to their next source.

import type { PrismaClient } from '@arete/db'
import type { ContainerGates, ContainerState, IssueContainer, PullRequest, SynthStep } from './types'

const PIPELINE_STATES: ReadonlySet<string> = new Set([
  'detecting', 'fanning_out', 'verifying', 'composing', 'ready',
  'solution_approved', 'posted', 'changes_requested', 'merged', 'dismissed', 'fix_failed',
])

type StoredDb = {
  issueContainer: { findFirst(args: unknown): Promise<Record<string, unknown> | null> }
}

export async function getStoredContainer(
  db: StoredDb | PrismaClient,
  installationIds: string[],
  id: string,
): Promise<IssueContainer | null> {
  if (installationIds.length === 0) return null
  const row = await (db as StoredDb).issueContainer.findFirst({
    where: { id, installationId: { in: installationIds } },
  })
  if (!row || typeof row.state !== 'string' || !PIPELINE_STATES.has(row.state)) return null

  const target = (row.target ?? null) as { owner?: string; repo?: string } | null
  const prJson = (row.pr ?? null) as
    | { base?: string; branch?: string; title?: string; body?: string; url?: string }
    | null
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? '')
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : createdAt

  const pr: PullRequest | null = prJson?.title
    ? {
        number: null,
        base: prJson.base ?? 'main',
        branch: prJson.branch ?? '',
        title: prJson.title,
        body: prJson.body ?? '',
        comments: [],
        state: 'ready',
        hostUrl: prJson.url ?? null,
      }
    : null

  return {
    id: String(row.id),
    installationId: String(row.installationId),
    serviceId: target?.owner && target?.repo ? `${target.owner}/${target.repo}` : 'repository',
    fingerprint: '',
    source: 'work_item',
    severity: 'medium',
    state: row.state as ContainerState,
    firstSeen: createdAt,
    lastSeen: updatedAt,
    occurrences: 1,
    evidence: [],
    findings: [],
    transcript: (Array.isArray(row.transcript) ? row.transcript : []) as SynthStep[],
    pr,
    gates: (row.gates ?? {
      solutionApprovedAt: null,
      solutionApprovedBy: null,
      postedAt: null,
      postedBy: null,
    }) as ContainerGates,
    createdAt,
    updatedAt,
  }
}
```

Then, in BOTH routes, change the resolution line from

```ts
const container = (await getReviewContainer(db, installationIds, id)) ?? getLiveSampleContainer(id);
```

to

```ts
const container =
  (await getReviewContainer(db, installationIds, id)) ??
  (await getStoredContainer(db, installationIds, id)) ??
  getLiveSampleContainer(id);
```

with `import { getStoredContainer } from "@/lib/issue-pipeline/stored-container";` — the stored row (real fix run) now streams its actual transcript and, at `ready`, passes `canApprove` in the approve route. (Read the approve route before editing: keep Eng2's post-merge ordering — store-save first, then the staged work-item hook — and verify its save path persists the approved state for stored rows via `PrismaContainerStore.save` on the same `issueContainer` table; if so nothing more is needed.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter dashboard exec vitest run src/lib/issue-pipeline/ src/app/api`
Expected: PASS (stream/approve suites keep passing — sample fallback intact for non-persisted ids).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/issue-pipeline/stored-container.ts packages/dashboard/src/lib/issue-pipeline/stored-container.test.ts "packages/dashboard/src/app/api/containers/[id]/stream/route.ts" "packages/dashboard/src/app/api/containers/[id]/approve/route.ts"
git commit -m "feat(dashboard): stream/approve resolve stored fix containers — real transitions, no sample"
```

---

### Task 8: Full-suite verification + checkpoint report (no commit unless fixes needed)

- [ ] **Step 1: Dashboard** — `pnpm --filter dashboard exec vitest run` → all green.
- [ ] **Step 2: Webhook** — `pnpm --filter @arete/webhook exec vitest run` → all green; `pnpm --filter @arete/webhook exec tsc --noEmit` → clean.
- [ ] **Step 3: Push the lane branch** — `git push origin stroland02/Engineer-4`.
- [ ] **Step 4: Checkpoint report to the PM**, flagging integration prerequisites per the checkpoint-deps rule:
  - Migration `add_container_transcript_work_item_fix_error` needs `prisma migrate deploy` + client regeneration on preview.
  - `ContainerState` gains `fix_failed`; `transcript` read path — **Eng2 ack required** (spec §8).
  - Worker process restart required (`pnpm worker` now also consumes `fix-workitem`).
  - Live e2e blocked on Eng3's agents `POST /fix`; all worker tests run against the frozen §3 fixture shapes.
  - PM one-off cleanup (spec §5): delete `state='open'` containers + reset their WorkItems `fixing → open` at integration time.

## Self-Review (done)

- **Spec coverage:** §2 dispatch chain → Tasks 3–5; §3 contract + grounding double-check + 300s timeout → Task 5; §4 detecting birth → Task 3, incremental persistence + transcript column → Tasks 2/5, `fix_failed` → Task 1, stream liveness → Task 7; §5 → PM (flagged Task 8); §6 guard/tenancy → Tasks 3/4; §7 lifecycle + reason → Tasks 5/6. Eng3/Eng2 items are out of lane.
- **Placeholder scan:** clean — every code step is complete; the two "verify while implementing" notes point at existing repo sources of truth (scan deps, Eng2's approve route), not unwritten designs.
- **Type consistency:** `FixJobData {workItemId}` (Tasks 3→4→5); `fixError` (Tasks 2→3→5→6); `transcript` steps SynthStep-shaped (Tasks 5→7); `"fix_failed"` literal everywhere (Task 1).
