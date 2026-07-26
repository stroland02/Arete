# Project Memory Read-Side Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between the already-working `AgentMemory` write path (human chat-reply → `save_memory` action) and the already-working read path (`agents/base.py`'s `project_memories` prompt injection) by adding the missing query that fetches saved memories before a new review runs.

**Architecture:** One new function, `fetchProjectMemories(provider, repositoryExternalId)`, added to `persistence.ts` alongside the file's existing Prisma-lookup functions (`reviewExists`, `persistReview`). It looks up the `Repository` row via the same `provider_externalId` unique constraint those functions already use, then queries `AgentMemory` for that repo. Wired into the two GitHub worker paths (`processGitHubPullRequest`, `processGitHubCheckRun`) alongside the existing telemetry/clone-context attachment.

**Tech Stack:** TypeScript/Express (`packages/webhook`), Prisma (`@arete/db`), vitest.

## Global Constraints

- **No schema change.** The `AgentMemory` model, its `status` field (`"active"`/`"archived"`), and its `[repositoryId, status]` index already exist in `packages/db/prisma/schema.prisma`.
- **Cap at 20 memories**, most recent first (`createdAt desc`), to bound prompt growth — matches the size-cap precedent already established for `repoConventions` (20,000 chars) in the immediately-preceding SP3a work.
- **Fail-open when no `Repository` row exists yet**: return `[]`, never throw. A repo with no prior review has no `AgentMemory` rows by construction (the FK requires a `repositoryId`).
- **GitHub only in this round** — `processGitLabMergeRequest` is explicitly NOT touched. `AgentMemory` currently has no write path from GitLab, so there's nothing to fetch there yet.
- **Exclude `"archived"`-status memories** — only `"active"` ones are fetched.
- **Testing convention:** `persistence.test.ts` mocks `@arete/db`'s `PrismaClient` directly (see its existing `makePrismaMock`/`loadPersistence` helpers) — no real database. `pipeline.integration.test.ts` has its own, larger Prisma mock (already includes `repository.findUnique`/`upsert`) that the full `processReviewJob` → `processGitHubPullRequest` path runs through — extend that one for the wiring test, following the exact pattern of its existing "fetches telemetry context" test.

---

### Task 1: `fetchProjectMemories` in `persistence.ts`

**Files:**
- Modify: `packages/webhook/src/persistence.ts`
- Modify: `packages/webhook/src/persistence.test.ts`

**Interfaces:**
- Consumes: nothing new (uses the existing `prisma` client import already at the top of `persistence.ts`).
- Produces: `fetchProjectMemories(provider: ScmProvider, repositoryExternalId: number): Promise<string[]>`. Task 2 imports this directly.

- [ ] **Step 1: Write the failing tests**

Read `packages/webhook/src/persistence.test.ts` first to see its exact current `makePrismaMock`/`loadPersistence` helpers (they currently only stub `installation` and `telemetrySnapshotRecord`). Extend `makePrismaMock` to add `repository` and `agentMemory`:

Change:
```ts
function makePrismaMock() {
  const installationFindUnique = vi.fn()
  const telemetrySnapshotRecordUpsert = vi.fn()

  class PrismaClient {
    installation = { findUnique: installationFindUnique }
    telemetrySnapshotRecord = { upsert: telemetrySnapshotRecordUpsert }
  }

  return { PrismaClient, installationFindUnique, telemetrySnapshotRecordUpsert }
}
```

to:

```ts
function makePrismaMock() {
  const installationFindUnique = vi.fn()
  const telemetrySnapshotRecordUpsert = vi.fn()
  const repositoryFindUnique = vi.fn()
  const agentMemoryFindMany = vi.fn()

  class PrismaClient {
    installation = { findUnique: installationFindUnique }
    telemetrySnapshotRecord = { upsert: telemetrySnapshotRecordUpsert }
    repository = { findUnique: repositoryFindUnique }
    agentMemory = { findMany: agentMemoryFindMany }
  }

  return {
    PrismaClient,
    installationFindUnique,
    telemetrySnapshotRecordUpsert,
    repositoryFindUnique,
    agentMemoryFindMany,
  }
}
```

Then append these tests to the same file (after the existing `describe('persistTelemetrySnapshots', ...)` block):

```ts
describe('fetchProjectMemories', () => {
  let mocks: ReturnType<typeof makePrismaMock>

  beforeEach(() => {
    mocks = makePrismaMock()
  })

  it('returns active memory bodies for an existing repo, most recent first', async () => {
    mocks.repositoryFindUnique.mockResolvedValue({ id: 'repo-uuid-1' })
    mocks.agentMemoryFindMany.mockResolvedValue([
      { body: 'Use tabs, not spaces.' },
      { body: 'Always run the linter before committing.' },
    ])
    const { fetchProjectMemories } = await loadPersistence(mocks)

    const result = await fetchProjectMemories('github', 1)

    expect(result).toEqual(['Use tabs, not spaces.', 'Always run the linter before committing.'])
    expect(mocks.agentMemoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repositoryId: 'repo-uuid-1', status: 'active' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    )
  })

  it('returns an empty array when no Repository row exists for that provider/externalId', async () => {
    mocks.repositoryFindUnique.mockResolvedValue(null)
    const { fetchProjectMemories } = await loadPersistence(mocks)

    const result = await fetchProjectMemories('github', 999)

    expect(result).toEqual([])
    expect(mocks.agentMemoryFindMany).not.toHaveBeenCalled()
  })

  it('returns an empty array when the repo has no active memories', async () => {
    mocks.repositoryFindUnique.mockResolvedValue({ id: 'repo-uuid-1' })
    mocks.agentMemoryFindMany.mockResolvedValue([])
    const { fetchProjectMemories } = await loadPersistence(mocks)

    const result = await fetchProjectMemories('github', 1)

    expect(result).toEqual([])
  })

  it('caps the query at 20 results', async () => {
    mocks.repositoryFindUnique.mockResolvedValue({ id: 'repo-uuid-1' })
    mocks.agentMemoryFindMany.mockResolvedValue([])
    const { fetchProjectMemories } = await loadPersistence(mocks)

    await fetchProjectMemories('github', 1)

    expect(mocks.agentMemoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook test persistence -- -t "fetchProjectMemories"`
Expected: FAIL — `fetchProjectMemories is not a function` (not exported from `./persistence.js` yet).

- [ ] **Step 3: Implement fetchProjectMemories**

In `packages/webhook/src/persistence.ts`, add this constant near the top of the file (alongside any existing module-level constants, or right after the imports if none exist):

```ts
const MAX_PROJECT_MEMORIES = 20
```

Add this function at the end of the file:

```ts
/**
 * Fetches up to MAX_PROJECT_MEMORIES active AgentMemory bodies for a repo,
 * most recently created first. Returns [] if no Repository row exists yet
 * for this (provider, externalId) pair — a repo with no prior review can't
 * have any AgentMemory rows (the FK requires a repositoryId) — or if the
 * repo simply has no active memories saved. Never throws for either case;
 * callers attach the result directly to PRContext.projectMemories, which
 * agents/base.py already treats as optional.
 */
export async function fetchProjectMemories(
  provider: ScmProvider,
  repositoryExternalId: number
): Promise<string[]> {
  const repository = await prisma.repository.findUnique({
    where: { provider_externalId: { provider, externalId: repositoryExternalId } },
  })
  if (!repository) return []

  const memories = await prisma.agentMemory.findMany({
    where: { repositoryId: repository.id, status: 'active' },
    orderBy: { createdAt: 'desc' },
    take: MAX_PROJECT_MEMORIES,
  })
  return memories.map((m: { body: string }) => m.body)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook test persistence -- -t "fetchProjectMemories"`
Expected: PASS (4 passed)

- [ ] **Step 5: Run the full webhook suite to confirm no regressions**

Run: `pnpm --filter @arete/webhook test`
Expected: same pass count as before plus 4 new passes; the one already-known pre-existing unrelated failure (`webhook-handler.test.ts` async-handoff test) is the only failure, unchanged from before this task.

- [ ] **Step 6: Commit**

```bash
git add packages/webhook/src/persistence.ts packages/webhook/src/persistence.test.ts
git commit -m "feat(webhook): add fetchProjectMemories query for saved AgentMemory rows"
```

---

### Task 2: Wire `fetchProjectMemories` into the GitHub worker paths

**Files:**
- Modify: `packages/webhook/src/types.ts`
- Modify: `packages/webhook/src/worker.ts`
- Modify: `packages/webhook/src/pipeline.integration.test.ts`

**Interfaces:**
- Consumes: `fetchProjectMemories(provider, repositoryExternalId)` from `persistence.ts` (Task 1).
- Produces: `PRContext.projectMemories?: string[]` on the TS type. No new public interface elsewhere — `processGitHubPullRequest`/`processGitHubCheckRun`'s existing signatures are unchanged; `prContext.projectMemories` is now populated before the pipeline runs.

**IMPORTANT — a gap found during planning, not in the spec's literal wording:** the TS `PRContext` interface in `types.ts` currently has NO `projectMemories` field at all (unlike the Python side, which already has `project_memories: list[str]` from an earlier commit). Without adding it here, `prContext.projectMemories = ...` in Step 3 below would not compile. This step is added to this task rather than split into its own — it's a one-line addition with no independent test value beyond what Step 1's integration test already covers.

- [ ] **Step 1: Add the missing TS field**

In `packages/webhook/src/types.ts`, add one field to the `PRContext` interface, right after `repoConventions?: string` (the field SP3a added most recently):

```ts
  projectMemories?: string[]
```

- [ ] **Step 2: Write the failing test**

Read `packages/webhook/src/pipeline.integration.test.ts` first to confirm its current exact `makePrismaMock` (it already includes `repository = { findUnique: repositoryFindUnique, upsert: repositoryUpsert }`, with `repositoryFindUnique` defaulting to `mockResolvedValue(null)`). Extend it to add `agentMemory`:

Change:
```ts
function makePrismaMock() {
  const installationFindUnique = vi.fn().mockResolvedValue(null)
  const installationUpsert = vi.fn().mockResolvedValue({ id: 'inst-uuid-1' })
  const installationUpdate = vi.fn().mockResolvedValue({})
  const repositoryFindUnique = vi.fn().mockResolvedValue(null)
  const repositoryUpsert = vi.fn().mockResolvedValue({ id: 'repo-uuid-1' })
  const reviewFindUnique = vi.fn().mockResolvedValue(null)
  const reviewCreate = vi.fn().mockResolvedValue({ id: 'review-uuid-1' })

  class PrismaClient {
    installation = { findUnique: installationFindUnique, upsert: installationUpsert, update: installationUpdate }
    repository = { findUnique: repositoryFindUnique, upsert: repositoryUpsert }
    review = { findUnique: reviewFindUnique, create: reviewCreate }
  }
  return {
    PrismaClient,
    installationFindUnique,
    installationUpsert,
    installationUpdate,
    repositoryFindUnique,
    repositoryUpsert,
    reviewFindUnique,
    reviewCreate,
  }
}
```

to:

```ts
function makePrismaMock() {
  const installationFindUnique = vi.fn().mockResolvedValue(null)
  const installationUpsert = vi.fn().mockResolvedValue({ id: 'inst-uuid-1' })
  const installationUpdate = vi.fn().mockResolvedValue({})
  const repositoryFindUnique = vi.fn().mockResolvedValue(null)
  const repositoryUpsert = vi.fn().mockResolvedValue({ id: 'repo-uuid-1' })
  const reviewFindUnique = vi.fn().mockResolvedValue(null)
  const reviewCreate = vi.fn().mockResolvedValue({ id: 'review-uuid-1' })
  const agentMemoryFindMany = vi.fn().mockResolvedValue([])

  class PrismaClient {
    installation = { findUnique: installationFindUnique, upsert: installationUpsert, update: installationUpdate }
    repository = { findUnique: repositoryFindUnique, upsert: repositoryUpsert }
    review = { findUnique: reviewFindUnique, create: reviewCreate }
    agentMemory = { findMany: agentMemoryFindMany }
  }
  return {
    PrismaClient,
    installationFindUnique,
    installationUpsert,
    installationUpdate,
    repositoryFindUnique,
    repositoryUpsert,
    reviewFindUnique,
    reviewCreate,
    agentMemoryFindMany,
  }
}
```

Then add this test to the `describe('pipeline integration: webhook -> queue -> worker -> review -> post', ...)` block, placed LAST (matching the existing "fetches telemetry context" test's own comment about needing to be last, since both tests register `vi.doMock` calls that are not re-registered by `buildApp` and would otherwise leak into later tests):

```ts
  it('fetches project memories and includes them in the PRContext sent to the Python pipeline', async () => {
    const runReviewPipelineMock = vi.fn().mockResolvedValue({
      pr_context: {}, file_reviews: [], overall_summary: 'ok', risk_level: 'low', total_comments: 0,
    })
    vi.doMock('./review-bridge.js', () => ({ runReviewPipeline: runReviewPipelineMock }))

    await buildApp(mocks)
    mocks.prisma.repositoryFindUnique.mockResolvedValue({ id: 'repo-uuid-1' })
    mocks.prisma.agentMemoryFindMany.mockResolvedValue([
      { body: 'Use tabs, not spaces.' },
    ])

    const { processReviewJob } = await import('./worker.js')
    await processReviewJob({
      provider: 'github', kind: 'pull_request', owner: 'acme', repo: 'api',
      repositoryExternalId: 1, fullName: 'acme/api', installationId: 42, prNumber: 1, headSha: 'abc',
    })

    const sentContext = runReviewPipelineMock.mock.calls[0][0]
    expect(sentContext.projectMemories).toEqual(['Use tabs, not spaces.'])
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @arete/webhook test pipeline.integration -- -t "fetches project memories"`
Expected: FAIL — `sentContext.projectMemories` is `undefined`, not `['Use tabs, not spaces.']` (the wiring doesn't exist yet).

- [ ] **Step 4: Wire fetchProjectMemories into both GitHub process functions**

In `packages/webhook/src/worker.ts`, add `fetchProjectMemories` to the existing import from `./persistence.js` (find the current import line for `persistReview`/`persistTelemetrySnapshots` and add it to that same import statement).

Then find `processGitHubPullRequest`'s body, currently:

```ts
  const prContext = await fetchPRContext(octokit, owner, repo, prNumber)
  // `installationId` here is the GitHub App's numeric installation id
  // (Installation.externalId), not the internal Installation UUID —
  // fetchTelemetryContext resolves the UUID itself, like persistReview.
  prContext.telemetry = await fetchTelemetryContext(
    octokit,
    'github',
    installationId,
    owner,
    repo,
    prContext.telemetryConnectors ?? []
  )

  Object.assign(prContext, buildCloneContext(fullName, installationId, installationToken))
```

Change it to:

```ts
  const prContext = await fetchPRContext(octokit, owner, repo, prNumber)
  // `installationId` here is the GitHub App's numeric installation id
  // (Installation.externalId), not the internal Installation UUID —
  // fetchTelemetryContext resolves the UUID itself, like persistReview.
  prContext.telemetry = await fetchTelemetryContext(
    octokit,
    'github',
    installationId,
    owner,
    repo,
    prContext.telemetryConnectors ?? []
  )
  prContext.projectMemories = await fetchProjectMemories('github', repositoryExternalId)

  Object.assign(prContext, buildCloneContext(fullName, installationId, installationToken))
```

Then find `processGitHubCheckRun`'s body, currently:

```ts
  const prContext = await fetchPRContext(octokit, owner, repo, prNumber)
  prContext.ciLogs = ciLogs
  Object.assign(prContext, buildCloneContext(fullName, installationId, installationToken))
```

Change it to:

```ts
  const prContext = await fetchPRContext(octokit, owner, repo, prNumber)
  prContext.ciLogs = ciLogs
  prContext.projectMemories = await fetchProjectMemories('github', repositoryExternalId)
  Object.assign(prContext, buildCloneContext(fullName, installationId, installationToken))
```

Do NOT modify `processGitLabMergeRequest` — GitLab is explicitly out of scope for this plan.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @arete/webhook test pipeline.integration -- -t "fetches project memories"`
Expected: PASS (1 passed)

- [ ] **Step 6: Run the full webhook suite to confirm no regressions**

Run: `pnpm --filter @arete/webhook test`
Expected: same pass count as after Task 1 plus 1 new pass; the one already-known pre-existing unrelated failure (`webhook-handler.test.ts` async-handoff test) remains the only failure, unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/webhook/src/types.ts packages/webhook/src/worker.ts packages/webhook/src/pipeline.integration.test.ts
git commit -m "feat(webhook): wire fetchProjectMemories into GitHub review pipeline"
```
