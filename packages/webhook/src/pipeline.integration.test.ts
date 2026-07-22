/**
 * Integration tests for the full webhook -> queue -> worker -> review -> post
 * pipeline.
 *
 * Real modules under test (NOT mocked): server.ts, webhook-handler.ts,
 * gitlab-handler.ts, worker.ts, pr-fetcher.ts, review-bridge.ts,
 * comment-poster.ts, gitlab-fetcher.ts, gitlab-comment-poster.ts,
 * persistence.ts.
 *
 * Mocked boundaries only:
 *  - @octokit/app + @octokit/webhooks (bypass HMAC, inject mock octokit)
 *  - global fetch (FastAPI POST /review, GitLab REST "changes"/"discussions")
 *  - octokit REST calls (GitHub API)
 *  - generated Prisma client (database)
 *  - ./queue.js (no real Redis/BullMQ in tests — jobs are captured instead
 *    of enqueued, then fed directly into worker.ts's processReviewJob() to
 *    simulate what the worker process would do with them)
 *  - ./github-auth.js (worker.ts builds its own installation-scoped octokit;
 *    redirected to the same mock octokit the webhook side used)
 *
 * This setup deliberately proves the async handoff: the webhook handlers now
 * only validate + enqueue, so a POST to /webhook or /gitlab-webhook resolves
 * WITHOUT the FastAPI/GitHub-posting/persistence calls having happened yet.
 * The pipeline only runs once the test explicitly hands the captured job to
 * processReviewJob(), mirroring what worker.ts does when BullMQ delivers it.
 *
 * Pattern: vi.doMock + vi.resetModules + dynamic import (vi.mock is hoisted
 * and cannot close over per-test mock instances; vi.doMock can).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import type { Application } from 'express'

// Each test here re-transpiles the real server + worker graph via dynamic
// import() after vi.resetModules(), which is CPU-heavy. Under load (the whole
// monorepo suite running at once), that can exceed vitest's default 5s
// testTimeout -- and a timeout ABORTS the test mid-flight while its
// processReviewJob() continuation keeps running, then leaks a fetch call into
// the next test (observed: "fetch called 2 times, expected 1"). The work
// itself is fully synchronous mocks (no real Redis/BullMQ, no real network),
// so a generous file-scoped budget removes the starvation flake without
// masking any genuine hang. Scoped to THIS file via setConfig so unit suites
// keep their fast-fail default.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

// --- env (never real secrets; test-only values) ---
vi.stubEnv('GITHUB_APP_ID', '12345')
vi.stubEnv('GITHUB_PRIVATE_KEY', '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n')
vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-webhook-secret')
vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake')
vi.stubEnv('GITLAB_WEBHOOK_SECRET', 'test-gitlab-secret')
vi.stubEnv('PORT', '3000')

// --- fixtures ---
const PR_PAYLOAD = {
  action: 'opened',
  repository: { id: 9001, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
  pull_request: { number: 42, head: { sha: 'headsha123' } },
  installation: { id: 777 },
}

const GITLAB_MR_PAYLOAD = {
  object_kind: 'merge_request',
  project: { id: 555, path_with_namespace: 'acme/gitlab-api' },
  object_attributes: {
    iid: 5,
    state: 'opened',
    action: 'open',
    title: 'Add rate limiter',
    description: 'Implements token bucket',
    diff_refs: { base_sha: 'basesha1', start_sha: 'startsha1' },
    last_commit: { id: 'headsha1' },
  },
}

const GITLAB_CHANGES_RESPONSE = {
  changes: [
    {
      new_path: 'src/limiter.ts',
      old_path: 'src/limiter.ts',
      diff: '+const bucket = new Map()\n+bucket.set("a", 1)',
      new_file: false,
      deleted_file: false,
      renamed_file: false,
    },
  ],
  title: 'Add rate limiter',
  description: 'Implements token bucket',
}

const REVIEW_RESULT = {
  pr_context: { repo: 'acme/api', pr_number: 42, title: 'Add rate limiter', description: '', files: [] },
  file_reviews: [
    {
      path: 'src/limiter.ts',
      comments: [
        {
          path: 'src/limiter.ts',
          line: 3,
          body: 'Bucket size is unbounded.',
          severity: 'warning',
          category: 'performance',
        },
      ],
      summary: 'One performance warning.',
    },
  ],
  overall_summary: 'Found 1 performance warning.',
  risk_level: 'medium',
  total_comments: 1,
}

// --- mock factories ---
function makeOctokit() {
  return {
    request: vi.fn().mockResolvedValue({}),
    rest: {
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: { number: 42, title: 'Add rate limiter', body: 'Implements token bucket', head: { sha: 'headsha123' }, base: { sha: 'basesha456', ref: 'main' } },
        }),
        listFiles: vi.fn().mockResolvedValue({
          data: [{ filename: 'src/limiter.ts', patch: '+const bucket = new Map()', additions: 1, deletions: 0 }],
        }),
        createReview: vi.fn().mockResolvedValue({}),
      },
      repos: {
        // no .arete.yml in the repo
        getContent: vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 })),
      },
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 555 } }),
        update: vi.fn().mockResolvedValue({}),
      },
    },
  }
}

function makePrismaMock() {
  const installationFindUnique = vi.fn().mockResolvedValue(null)
  const installationUpsert = vi.fn().mockResolvedValue({ id: 'inst-uuid-1' })
  const installationUpdate = vi.fn().mockResolvedValue({})
  const repositoryFindUnique = vi.fn().mockResolvedValue(null)
  const repositoryUpsert = vi.fn().mockResolvedValue({ id: 'repo-uuid-1' })
  const reviewFindUnique = vi.fn().mockResolvedValue(null)
  const reviewCreate = vi.fn().mockResolvedValue({ id: 'review-uuid-1' })
  const agentMemoryFindMany = vi.fn().mockResolvedValue([])
  // persistReview fires an outbound review.created webhook via PrismaWebhookStore
  // (reads webhookEndpoint, writes webhookDelivery). Model both so the emit
  // no-ops cleanly (no endpoints → no delivery) instead of throwing on an
  // undefined delegate.
  const webhookEndpointFindMany = vi.fn().mockResolvedValue([])
  const webhookDeliveryCreate = vi.fn()

  class PrismaClient {
    installation = { findUnique: installationFindUnique, upsert: installationUpsert, update: installationUpdate }
    repository = { findUnique: repositoryFindUnique, upsert: repositoryUpsert }
    review = { findUnique: reviewFindUnique, create: reviewCreate }
    agentMemory = { findMany: agentMemoryFindMany }
    webhookEndpoint = { findMany: webhookEndpointFindMany }
    webhookDelivery = { create: webhookDeliveryCreate }
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
    webhookEndpointFindMany,
    webhookDeliveryCreate,
  }
}

type Mocks = {
  octokit: ReturnType<typeof makeOctokit>
  prisma: ReturnType<typeof makePrismaMock>
  fetchMock: ReturnType<typeof vi.fn>
  capturedJobs: any[]
}

/**
 * A single global-fetch mock has to serve every external HTTP boundary the
 * pipeline hits (FastAPI /review, GitLab's "changes" and "discussions"
 * REST endpoints all go through the native fetch()), so this router picks a
 * canned response based on the request URL.
 */
function makeRoutedFetchMock(overrides: { reviewResult?: any } = {}) {
  const reviewResult = overrides.reviewResult ?? REVIEW_RESULT
  return vi.fn(async (url: string) => {
    if (url === 'http://127.0.0.1:8000/review') {
      return {
        ok: true,
        json: async () => reviewResult,
        text: async () => JSON.stringify(reviewResult),
      }
    }
    if (url.includes('/merge_requests/') && url.endsWith('/changes')) {
      return {
        ok: true,
        json: async () => GITLAB_CHANGES_RESPONSE,
        text: async () => JSON.stringify(GITLAB_CHANGES_RESPONSE),
      }
    }
    if (url.includes('/discussions')) {
      return { ok: true, json: async () => ({}), text: async () => '' }
    }
    throw new Error(`Unmocked fetch URL in test: ${url}`)
  })
}

/**
 * Builds the Express app with all external boundaries mocked. The queue is
 * replaced with an in-memory capture array instead of real BullMQ/Redis —
 * tests explicitly feed captured jobs into worker.ts's processReviewJob() to
 * simulate the worker consuming them.
 *
 * The fake createNodeMiddleware parses the raw JSON body and dispatches to
 * the handlers the real server registered — HMAC validation is bypassed,
 * everything downstream is the real code path.
 */
type BuildOverrides = {
  /** When set, ./telemetry/fetch-telemetry-context.js resolves to this fixed value. */
  telemetryContext?: unknown[]
  /** When set, ./review-bridge.js runReviewPipeline is replaced by this mock. */
  runReviewPipeline?: ReturnType<typeof vi.fn>
}

async function buildApp(mocks: Mocks, overrides: BuildOverrides = {}): Promise<Application> {
  vi.resetModules()

  // EVERY module this file ever mocks is (re-)registered or explicitly
  // un-mocked here, unconditionally — vi.resetModules() clears the module
  // cache but not the doMock registry, so anything registered outside this
  // function would leak into later tests and make the file order-dependent.
  if (overrides.telemetryContext !== undefined) {
    const telemetryContext = overrides.telemetryContext
    vi.doMock('./telemetry/fetch-telemetry-context.js', () => ({
      fetchTelemetryContext: vi.fn().mockResolvedValue(telemetryContext),
    }))
  } else {
    vi.doUnmock('./telemetry/fetch-telemetry-context.js')
  }
  if (overrides.runReviewPipeline !== undefined) {
    const runReviewPipeline = overrides.runReviewPipeline
    vi.doMock('./review-bridge.js', () => ({ runReviewPipeline }))
  } else {
    vi.doUnmock('./review-bridge.js')
  }

  vi.doMock('@octokit/app', () => {
    class App {
      webhooks: {
        handlers: Map<string, ((...args: any[]) => any)[]>
        on: (event: string | string[], handler: (...args: any[]) => any) => void
      }
      constructor(_opts: unknown) {
        const handlers = new Map<string, ((...args: any[]) => any)[]>()
        this.webhooks = {
          handlers,
          on(event: string | string[], handler: (...args: any[]) => any) {
            for (const e of Array.isArray(event) ? event : [event]) {
              if (!handlers.has(e)) handlers.set(e, [])
              handlers.get(e)!.push(handler)
            }
          },
        }
      }
    }
    return { App }
  })

  vi.doMock('@octokit/webhooks', () => ({
    createNodeMiddleware: (webhooks: any, { path }: { path: string }) => {
      return (req: any, res: any, next: any) => {
        if (req.method !== 'POST' || req.url.split('?')[0] !== path) return next()
        let raw = ''
        req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
        req.on('end', async () => {
          try {
            const payload = JSON.parse(raw)
            const event = req.headers['x-github-event']
            const handlers: ((...args: any[]) => any)[] = webhooks.handlers.get(event) ?? []
            for (const handler of handlers) {
              await handler({ octokit: mocks.octokit, payload })
            }
            res.statusCode = 200
            res.end('ok')
          } catch (err) {
            res.statusCode = 500
            res.end(String(err))
          }
        })
      }
    },
  }))

  vi.doMock('@arete/db', () => ({ PrismaClient: mocks.prisma.PrismaClient }))

  vi.doMock('./queue.js', () => ({
    enqueueReviewJob: vi.fn(async (data: any) => {
      mocks.capturedJobs.push(data)
      return { id: `job-${mocks.capturedJobs.length}` }
    }),
    REVIEW_QUEUE_NAME: 'review-pr',
    REVIEW_QUEUE_CONCURRENCY: 5,
  }))

  vi.doMock('./github-auth.js', () => ({
    createApp: vi.fn(() => ({})),
    getInstallationOctokit: vi.fn(async () => mocks.octokit),
    getInstallationToken: vi.fn(async () => 'ghs_test_token'),
  }))

  vi.stubGlobal('fetch', mocks.fetchMock)

  const { createServer } = await import('./server.js')
  return createServer()
}

/** Simulates the worker process picking up the single captured job. */
async function runCapturedJob(mocks: Mocks): Promise<void> {
  expect(mocks.capturedJobs).toHaveLength(1)
  const { processReviewJob } = await import('./worker.js')
  await processReviewJob(mocks.capturedJobs[0])
}

describe('pipeline integration: webhook -> queue -> worker -> review -> post', () => {
  let mocks: Mocks

  beforeEach(() => {
    mocks = {
      octokit: makeOctokit(),
      prisma: makePrismaMock(),
      fetchMock: makeRoutedFetchMock(),
      capturedJobs: [],
    }
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.doUnmock('./telemetry/fetch-telemetry-context.js')
    vi.doUnmock('./review-bridge.js')
    vi.resetModules()
    // Regression guard for 515b30a: this asserts what the two doUnmock calls
    // just above are supposed to guarantee -- that after teardown, both
    // buildApp-managed mocks (review-bridge.js, fetch-telemetry-context.js)
    // are actually un-registered, not just requested to be. It does NOT
    // guard against some hypothetical future test that mocks a module
    // outside buildApp (the unconditional doUnmock calls above already
    // neutralize that case on their own); it guards those doUnmock calls
    // themselves from being silently weakened or removed, which would
    // reintroduce the "keep this test LAST" order-dependence from 515b30a
    // without any test here catching it.
    const bridge = await import('./review-bridge.js')
    expect(vi.isMockFunction(bridge.runReviewPipeline)).toBe(false)
    const telemetry = await import('./telemetry/fetch-telemetry-context.js')
    expect(vi.isMockFunction(telemetry.fetchTelemetryContext)).toBe(false)
  })

  it('async handoff: pull_request.opened returns 200 immediately, enqueues a job, and does NOT run the pipeline until the job is processed', async () => {
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .send(JSON.stringify(PR_PAYLOAD))
    expect(res.status).toBe(200)

    // The webhook response resolved without the pipeline having run at all.
    expect(mocks.capturedJobs).toHaveLength(1)
    expect(mocks.capturedJobs[0]).toMatchObject({
      provider: 'github',
      kind: 'pull_request',
      owner: 'acme',
      repo: 'api',
      prNumber: 42,
      installationId: 777,
      headSha: 'headsha123',
    })
    expect(mocks.octokit.rest.pulls.get).not.toHaveBeenCalled()
    expect(mocks.fetchMock).not.toHaveBeenCalled()
    expect(mocks.octokit.rest.checks.create).not.toHaveBeenCalled()

    // Now simulate the worker picking up the job.
    await runCapturedJob(mocks)

    expect(mocks.octokit.rest.pulls.get).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', pull_number: 42 })
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.octokit.rest.pulls.createReview).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.reviewCreate).toHaveBeenCalledTimes(1)
  })

  it('happy path: pull_request.opened -> job -> fetch diff -> FastAPI -> posted review -> Prisma transaction', async () => {
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .send(JSON.stringify(PR_PAYLOAD))
    expect(res.status).toBe(200)

    await runCapturedJob(mocks)

    // 1. PR context fetched from GitHub
    expect(mocks.octokit.rest.pulls.get).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', pull_number: 42 })
    expect(mocks.octokit.rest.pulls.listFiles).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', pull_number: 42, per_page: 100, page: 1 })

    // 2. FastAPI bridge called with the assembled PRContext
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = mocks.fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/review')
    const sentContext = JSON.parse(init.body)
    expect(sentContext.repo).toBe('acme/api')
    expect(sentContext.pr_number).toBe(42)
    expect(sentContext.files).toHaveLength(1)
    expect(sentContext.files[0]).toMatchObject({ path: 'src/limiter.ts', language: 'typescript' })

    // 3. Review posted back to GitHub with formatted inline comment
    expect(mocks.octokit.rest.pulls.createReview).toHaveBeenCalledTimes(1)
    const reviewArgs = mocks.octokit.rest.pulls.createReview.mock.calls[0][0]
    expect(reviewArgs).toMatchObject({ owner: 'acme', repo: 'api', pull_number: 42, event: 'COMMENT' })
    expect(reviewArgs.body).toContain('Areté Code Review')
    expect(reviewArgs.body).toContain('MEDIUM')
    expect(reviewArgs.comments).toHaveLength(1)
    expect(reviewArgs.comments[0]).toMatchObject({ path: 'src/limiter.ts', line: 3 })
    expect(reviewArgs.comments[0].body).toContain('[WARNING]')

    // 4. Check run lifecycle: created in_progress, completed success (medium risk)
    expect(mocks.octokit.rest.checks.create).toHaveBeenCalledTimes(1)
    expect(mocks.octokit.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({ check_run_id: 555, status: 'completed', conclusion: 'success' })
    )

    // 5. Persistence: provider-scoped upserts (UUID PKs, no manual ids)
    expect(mocks.prisma.installationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider_externalId: { provider: 'github', externalId: 777 } },
        create: expect.objectContaining({ provider: 'github', externalId: 777, owner: 'acme' }),
      })
    )
    expect(mocks.prisma.repositoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider_externalId: { provider: 'github', externalId: 9001 } },
        create: expect.objectContaining({
          provider: 'github',
          externalId: 9001,
          fullName: 'acme/api',
          installationId: 'inst-uuid-1',
        }),
      })
    )
    const reviewCreateArgs = mocks.prisma.reviewCreate.mock.calls[0][0]
    expect(reviewCreateArgs.data).toMatchObject({
      prNumber: 42,
      riskLevel: 'medium',
      repositoryId: 'repo-uuid-1',
      headSha: 'headsha123',
      analysisStatus: 'complete',
    })
    // Usage counter incremented for the billing scaffolding
    expect(mocks.prisma.installationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { usageCount: { increment: 1 } } })
    )
    expect(reviewCreateArgs.data.comments.createMany.data).toHaveLength(1)
    expect(reviewCreateArgs.data.comments.createMany.data[0]).toMatchObject({
      path: 'src/limiter.ts',
      line: 3,
      severity: 'warning',
      category: 'performance',
    })
  })

  it('subscription gate: canceled installation posts "paused" comment and skips enqueueing entirely', async () => {
    mocks.prisma.installationFindUnique.mockResolvedValue({
      id: 'inst-1',
      provider: 'github',
      externalId: 777,
      subscriptionStatus: 'canceled',
    })
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .send(JSON.stringify(PR_PAYLOAD))
    expect(res.status).toBe(200)

    // Paused comment posted on the PR
    expect(mocks.octokit.request).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
      expect.objectContaining({
        owner: 'acme',
        repo: 'api',
        issue_number: 42,
        body: expect.stringContaining('paused'),
      })
    )

    // No job enqueued, pipeline never ran
    expect(mocks.capturedJobs).toHaveLength(0)
    expect(mocks.octokit.rest.pulls.get).not.toHaveBeenCalled()
    expect(mocks.fetchMock).not.toHaveBeenCalled()
    expect(mocks.octokit.rest.pulls.createReview).not.toHaveBeenCalled()
    expect(mocks.prisma.reviewCreate).not.toHaveBeenCalled()
  })

  it('duplicate delivery: a redelivered webhook for a head SHA that already has a completed review does not enqueue a second job', async () => {
    mocks.prisma.repositoryFindUnique.mockResolvedValue({ id: 'repo-uuid-1', provider: 'github', externalId: 9001 })
    mocks.prisma.reviewFindUnique.mockResolvedValue({
      id: 'review-uuid-1',
      repositoryId: 'repo-uuid-1',
      prNumber: 42,
      headSha: 'headsha123',
    })
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .send(JSON.stringify(PR_PAYLOAD))
    expect(res.status).toBe(200)

    expect(mocks.capturedJobs).toHaveLength(0)
    expect(mocks.fetchMock).not.toHaveBeenCalled()
  })

  it('FastAPI timeout: AbortError is caught in the worker, check run marked failed, no crash', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    mocks.fetchMock.mockRejectedValue(abortError)
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .send(JSON.stringify(PR_PAYLOAD))
    expect(res.status).toBe(200)

    const { processReviewJob } = await import('./worker.js')
    await expect(processReviewJob(mocks.capturedJobs[0])).rejects.toThrow()

    // Pipeline was attempted (check run created before the FastAPI call)...
    expect(mocks.octokit.rest.checks.create).toHaveBeenCalledTimes(1)
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1)

    // No review is posted and nothing is persisted...
    expect(mocks.octokit.rest.pulls.createReview).not.toHaveBeenCalled()
    expect(mocks.prisma.reviewCreate).not.toHaveBeenCalled()

    // ...but the check run must be resolved to "failure" rather than left
    // stuck "in_progress" forever on the PR.
    expect(mocks.octokit.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        check_run_id: 555,
        status: 'completed',
        conclusion: 'failure',
      })
    )
  })

  it('partial success: pipeline produces a usable result but posting to GitHub fails -> job does NOT throw (no full-pipeline retry), check run recorded as failed', async () => {
    // Non-422 failure on every attempt -- postReview's own 422 fallback
    // doesn't apply, so this always throws (e.g. rate limit, GitHub outage).
    mocks.octokit.rest.pulls.createReview.mockRejectedValue(
      Object.assign(new Error('GitHub API rate limited'), { status: 500 })
    )
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .send(JSON.stringify(PR_PAYLOAD))
    expect(res.status).toBe(200)

    const { processReviewJob } = await import('./worker.js')
    // The pipeline already produced a usable ReviewResult (the mocked
    // FastAPI /review call succeeds) -- only posting it back to GitHub
    // fails. Re-running the whole job would redo the entire files x agents
    // review for nothing (the double-retry this task removes), so the job
    // must resolve, not throw/reject.
    await expect(processReviewJob(mocks.capturedJobs[0])).resolves.toBeUndefined()

    // The pipeline DID run (FastAPI /review was called) -- proving a usable
    // result existed before the post failure.
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1)
    // Posting was attempted and failed.
    expect(mocks.octokit.rest.pulls.createReview).toHaveBeenCalledTimes(1)
    // Check run resolved (not left stuck "in_progress") with a failure
    // conclusion reflecting that the review never reached GitHub.
    expect(mocks.octokit.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({ check_run_id: 555, status: 'completed', conclusion: 'failure' })
    )
    // No retry means this attempt never re-persists (the point of the fix).
    expect(mocks.prisma.reviewCreate).not.toHaveBeenCalled()
  })

  it('genuine infra crash: pipeline yields no result at all -> job DOES throw (still retried by attempts:3)', async () => {
    const runReviewPipelineMock = vi.fn().mockRejectedValue(new Error('Python pipeline exited with status 500: internal error'))
    await buildApp(mocks, { runReviewPipeline: runReviewPipelineMock })

    const { processReviewJob } = await import('./worker.js')
    // No ReviewResult was ever produced -- a genuine infra crash. This must
    // still propagate so BullMQ's attempts:3/backoff retries it; that is the
    // ONLY case this task's fix leaves re-throwing.
    await expect(processReviewJob({
      provider: 'github', kind: 'pull_request', owner: 'acme', repo: 'api',
      repositoryExternalId: 1, fullName: 'acme/api', installationId: 42, prNumber: 1, headSha: 'abc',
    })).rejects.toThrow('Python pipeline exited with status 500')

    // Posting never happens -- there was nothing to post.
    expect(mocks.octokit.rest.pulls.createReview).not.toHaveBeenCalled()
    expect(mocks.octokit.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', conclusion: 'failure' })
    )
  })

  it('GitLab happy path: valid MR event -> job -> fetch diff -> FastAPI -> posted discussion -> Prisma transaction', async () => {
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/gitlab-webhook')
      .set('Content-Type', 'application/json')
      .set('X-Gitlab-Token', 'test-gitlab-secret')
      .send(GITLAB_MR_PAYLOAD)
    expect(res.status).toBe(200)
    expect(res.text).toBe('OK')

    // Enqueued, not yet run
    expect(mocks.capturedJobs).toHaveLength(1)
    expect(mocks.capturedJobs[0]).toMatchObject({ provider: 'gitlab', kind: 'merge_request', projectId: 555, mrIid: 5 })
    expect(mocks.fetchMock).not.toHaveBeenCalled()

    await runCapturedJob(mocks)

    // 1. MR diff fetched from GitLab's REST API
    const changesCall = mocks.fetchMock.mock.calls.find(([u]: any[]) => u.endsWith('/changes'))
    expect(changesCall).toBeDefined()
    expect(changesCall![0]).toBe('https://gitlab.com/api/v4/projects/555/merge_requests/5/changes')

    // 2. FastAPI bridge called with the diff-derived PRContext
    const reviewCall = mocks.fetchMock.mock.calls.find(([u]: any[]) => u === 'http://127.0.0.1:8000/review')
    expect(reviewCall).toBeDefined()
    const sentContext = JSON.parse(reviewCall![1].body)
    expect(sentContext.repo).toBe('acme/gitlab-api')
    expect(sentContext.pr_number).toBe(5)
    expect(sentContext.title).toBe('Add rate limiter')
    expect(sentContext.files).toHaveLength(1)
    expect(sentContext.files[0]).toMatchObject({ path: 'src/limiter.ts', language: 'typescript' })

    // 3. Review posted back as GitLab discussions: one per inline comment, plus a summary note
    const discussionCalls = mocks.fetchMock.mock.calls.filter(([u]: any[]) => u.endsWith('/discussions'))
    expect(discussionCalls).toHaveLength(2)
    const inlineBody = JSON.parse(discussionCalls[0][1].body)
    expect(inlineBody.position).toMatchObject({
      base_sha: 'basesha1',
      start_sha: 'startsha1',
      head_sha: 'headsha1',
      new_path: 'src/limiter.ts',
      new_line: 3,
    })
    const summaryBody = JSON.parse(discussionCalls[1][1].body)
    expect(summaryBody.body).toContain('Areté Code Review')
    expect(summaryBody.position).toBeUndefined()

    // 4. Persistence: GitLab entities namespaced with a "gitlab-" prefix
    const reviewCreateArgs = mocks.prisma.reviewCreate.mock.calls[0][0]
    expect(reviewCreateArgs.data).toMatchObject({ prNumber: 5, riskLevel: 'medium' })
  })

  it('GitLab invalid token: 401, no job enqueued', async () => {
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/gitlab-webhook')
      .set('Content-Type', 'application/json')
      .set('X-Gitlab-Token', 'wrong-token')
      .send(GITLAB_MR_PAYLOAD)
    expect(res.status).toBe(401)
    expect(mocks.capturedJobs).toHaveLength(0)
    expect(mocks.fetchMock).not.toHaveBeenCalled()
  })

  it('422 fallback: inline comments rejected -> review re-posted body-only', async () => {
    mocks.octokit.rest.pulls.createReview
      .mockRejectedValueOnce(Object.assign(new Error('Unprocessable'), { status: 422 }))
      .mockResolvedValueOnce({})
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .send(JSON.stringify(PR_PAYLOAD))
    expect(res.status).toBe(200)

    await runCapturedJob(mocks)

    expect(mocks.octokit.rest.pulls.createReview).toHaveBeenCalledTimes(2)
    const retryArgs = mocks.octokit.rest.pulls.createReview.mock.calls[1][0]
    expect(retryArgs.comments).toEqual([])
    // Pipeline continued to completion after the fallback
    expect(mocks.prisma.reviewCreate).toHaveBeenCalledTimes(1)
  })

  it('fetches telemetry context and includes it in the PRContext sent to the Python pipeline', async () => {
    const runReviewPipelineMock = vi.fn().mockResolvedValue({
      pr_context: {}, file_reviews: [], overall_summary: 'ok', risk_level: 'low', total_comments: 0,
    })
    // Reuses the shared boundary mocks (octokit via github-auth, @arete/db,
    // queue) that buildApp registers, then feeds job data straight into the
    // worker exactly like runCapturedJob does.
    await buildApp(mocks, {
      telemetryContext: [
        { provider: 'github_actions', source_ref: 'acme/api', summary_text: 'ok', metrics: {}, links: [], fetched_at: '2026-07-10T00:00:00Z' },
      ],
      runReviewPipeline: runReviewPipelineMock,
    })

    const { processReviewJob } = await import('./worker.js')
    await processReviewJob({
      provider: 'github', kind: 'pull_request', owner: 'acme', repo: 'api',
      repositoryExternalId: 1, fullName: 'acme/api', installationId: 42, prNumber: 1, headSha: 'abc',
    })

    const sentContext = runReviewPipelineMock.mock.calls[0][0]
    expect(sentContext.telemetry).toEqual([
      { provider: 'github_actions', source_ref: 'acme/api', summary_text: 'ok', metrics: {}, links: [], fetched_at: '2026-07-10T00:00:00Z' },
    ])
  })

  it('fetches project memories and includes them in the PRContext sent to the Python pipeline', async () => {
    const runReviewPipelineMock = vi.fn().mockResolvedValue({
      pr_context: {}, file_reviews: [], overall_summary: 'ok', risk_level: 'low', total_comments: 0,
    })

    await buildApp(mocks, { runReviewPipeline: runReviewPipelineMock })
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

  describe('check_run (CI-diagnosis) path retry parity', () => {
    // The pull_request path (Phase 3 Task 10) already distinguishes
    // "no result -> retry" from "result produced, publish failed -> don't
    // retry". processGitHubCheckRun ran the pre-fix shared try/catch, so a
    // publish-only failure re-ran the whole CI-diagnosis LLM pipeline. These
    // pin the same two-branch behavior for check_run.
    // `as const` on the discriminants keeps them as literal types ('github' /
    // 'check_run') so this object is assignable to the ReviewJobData union when
    // passed to processReviewJob; a bare const would widen them to `string`
    // (TS2345). The existing inline pull_request jobs avoid this by being
    // contextually typed at the call site.
    const checkRunJob = {
      provider: 'github' as const, kind: 'check_run' as const, owner: 'acme', repo: 'api',
      repositoryExternalId: 1, fullName: 'acme/api', installationId: 42,
      prNumber: 1, headSha: 'abc', ciLogs: 'build failed: TypeError at foo.ts:3',
    }

    it('partial success: pipeline produced a usable result but posting failed -> job does NOT throw (no full-pipeline retry)', async () => {
      mocks.octokit.rest.pulls.createReview.mockRejectedValue(
        Object.assign(new Error('GitHub API rate limited'), { status: 500 })
      )
      await buildApp(mocks)
      const { processReviewJob } = await import('./worker.js')

      await expect(processReviewJob(checkRunJob)).resolves.toBeUndefined()

      expect(mocks.fetchMock).toHaveBeenCalledTimes(1)              // pipeline ran
      expect(mocks.octokit.rest.pulls.createReview).toHaveBeenCalledTimes(1) // publish attempted
      expect(mocks.octokit.rest.checks.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed', conclusion: 'failure' })
      )
      expect(mocks.prisma.reviewCreate).not.toHaveBeenCalled()      // not retried, not re-persisted
    })

    it('genuine infra crash: pipeline yields no result -> job DOES throw (still retried by attempts:3)', async () => {
      const runReviewPipelineMock = vi.fn().mockRejectedValue(
        new Error('Python pipeline exited with status 500: internal error')
      )
      await buildApp(mocks, { runReviewPipeline: runReviewPipelineMock })
      const { processReviewJob } = await import('./worker.js')

      await expect(processReviewJob(checkRunJob)).rejects.toThrow('Python pipeline exited with status 500')
      expect(mocks.octokit.rest.pulls.createReview).not.toHaveBeenCalled()
      expect(mocks.octokit.rest.checks.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed', conclusion: 'failure' })
      )
    })
  })
})
