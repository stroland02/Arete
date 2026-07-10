/**
 * Integration tests for the full webhook → review → post pipeline.
 *
 * Real modules under test (NOT mocked): server.ts, webhook-handler.ts,
 * pr-fetcher.ts, review-bridge.ts, comment-poster.ts, gitlab-handler.ts.
 *
 * Mocked boundaries only:
 *  - @octokit/app + @octokit/webhooks (bypass HMAC, inject mock octokit)
 *  - global fetch (FastAPI POST /review)
 *  - octokit REST calls (GitHub API)
 *  - generated Prisma client (database)
 *
 * Pattern: vi.doMock + vi.resetModules + dynamic import (vi.mock is hoisted
 * and cannot close over per-test mock instances; vi.doMock can).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import type { Application } from 'express'

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
  project: { path_with_namespace: 'acme/gitlab-api' },
  object_attributes: {
    iid: 5,
    state: 'opened',
    action: 'open',
    title: 'Add rate limiter',
    description: 'Implements token bucket',
  },
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
          data: { number: 42, title: 'Add rate limiter', body: 'Implements token bucket', head: { sha: 'headsha123' } },
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
  const installationFindFirst = vi.fn().mockResolvedValue(null)
  const installationUpsert = vi.fn().mockReturnValue({ op: 'installation.upsert' })
  const repositoryUpsert = vi.fn().mockReturnValue({ op: 'repository.upsert' })
  const reviewCreate = vi.fn().mockReturnValue({ op: 'review.create' })
  const $transaction = vi.fn().mockResolvedValue([{}, {}, {}])

  class PrismaClient {
    installation = { findFirst: installationFindFirst, upsert: installationUpsert }
    repository = { upsert: repositoryUpsert }
    review = { create: reviewCreate }
    $transaction = $transaction
  }
  return { PrismaClient, installationFindFirst, installationUpsert, repositoryUpsert, reviewCreate, $transaction }
}

type Mocks = {
  octokit: ReturnType<typeof makeOctokit>
  prisma: ReturnType<typeof makePrismaMock>
  fetchMock: ReturnType<typeof vi.fn>
}

/**
 * Builds the Express app with all external boundaries mocked.
 * The fake createNodeMiddleware parses the raw JSON body and dispatches to
 * the handlers the real server registered — HMAC validation is bypassed,
 * everything downstream is the real code path.
 */
async function buildApp(mocks: Mocks): Promise<Application> {
  vi.resetModules()

  vi.doMock('@octokit/app', () => {
    class App {
      webhooks: {
        handlers: Map<string, Function[]>
        on: (event: string | string[], handler: Function) => void
      }
      constructor(_opts: unknown) {
        const handlers = new Map<string, Function[]>()
        this.webhooks = {
          handlers,
          on(event: string | string[], handler: Function) {
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
            const handlers: Function[] = webhooks.handlers.get(event) ?? []
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

  vi.doMock('./generated/prisma/client.js', () => ({ PrismaClient: mocks.prisma.PrismaClient }))

  vi.stubGlobal('fetch', mocks.fetchMock)

  const { createServer } = await import('./server.js')
  return createServer()
}

describe('pipeline integration: webhook → review → post', () => {
  let mocks: Mocks

  beforeEach(() => {
    mocks = {
      octokit: makeOctokit(),
      prisma: makePrismaMock(),
      fetchMock: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => REVIEW_RESULT,
        text: async () => JSON.stringify(REVIEW_RESULT),
      }),
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('happy path: pull_request.opened → fetch diff → FastAPI → posted review → Prisma transaction', async () => {
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .send(JSON.stringify(PR_PAYLOAD))
    expect(res.status).toBe(200)

    // 1. PR context fetched from GitHub
    expect(mocks.octokit.rest.pulls.get).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', pull_number: 42 })
    expect(mocks.octokit.rest.pulls.listFiles).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', pull_number: 42, per_page: 100 })

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

    // 5. Persistence: single $transaction with installation + repository + review
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.installationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ githubInstallationId: 777, owner: 'acme' }) })
    )
    expect(mocks.prisma.repositoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ githubRepoId: 9001, fullName: 'acme/api' }) })
    )
    const reviewCreateArgs = mocks.prisma.reviewCreate.mock.calls[0][0]
    expect(reviewCreateArgs.data).toMatchObject({ prNumber: 42, riskLevel: 'medium' })
    expect(reviewCreateArgs.data.comments.createMany.data).toHaveLength(1)
    expect(reviewCreateArgs.data.comments.createMany.data[0]).toMatchObject({
      path: 'src/limiter.ts',
      line: 3,
      severity: 'warning',
      category: 'performance',
    })
  })

  it('subscription gate: canceled installation posts "paused" comment and skips the review', async () => {
    mocks.prisma.installationFindFirst.mockResolvedValue({
      id: 'inst-1',
      githubInstallationId: 777,
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

    // Review pipeline never ran
    expect(mocks.octokit.rest.pulls.get).not.toHaveBeenCalled()
    expect(mocks.fetchMock).not.toHaveBeenCalled()
    expect(mocks.octokit.rest.pulls.createReview).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('FastAPI timeout: AbortError is caught upstream, no review posted, no crash', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    mocks.fetchMock.mockRejectedValue(abortError)
    const app = await buildApp(mocks)

    // Server catches handler errors, so the webhook endpoint must still respond.
    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .send(JSON.stringify(PR_PAYLOAD))
    expect(res.status).toBe(200)

    // Pipeline was attempted (check run created before the FastAPI call)...
    expect(mocks.octokit.rest.checks.create).toHaveBeenCalledTimes(1)
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1)

    // ...but nothing after the timeout ran.
    expect(mocks.octokit.rest.pulls.createReview).not.toHaveBeenCalled()
    expect(mocks.octokit.rest.checks.update).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('GitLab happy path: valid MR event with correct token → FastAPI called, 200 returned', async () => {
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/gitlab-webhook')
      .set('Content-Type', 'application/json')
      .set('X-Gitlab-Token', 'test-gitlab-secret')
      .send(GITLAB_MR_PAYLOAD)
    expect(res.status).toBe(200)
    expect(res.text).toBe('OK')

    // Pipeline is fire-and-forget: wait for the async FastAPI call.
    await vi.waitFor(() => expect(mocks.fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = mocks.fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/review')
    const sentContext = JSON.parse(init.body)
    expect(sentContext.repo).toBe('acme/gitlab-api')
    expect(sentContext.pr_number).toBe(5)
    expect(sentContext.title).toBe('Add rate limiter')
    // GitLab diff fetching is not implemented yet — handler sends empty files.
    expect(sentContext.files).toEqual([])
  })

  it('GitLab invalid token: 401, pipeline never invoked', async () => {
    const app = await buildApp(mocks)

    const res = await request(app)
      .post('/gitlab-webhook')
      .set('Content-Type', 'application/json')
      .set('X-Gitlab-Token', 'wrong-token')
      .send(GITLAB_MR_PAYLOAD)
    expect(res.status).toBe(401)
    expect(mocks.fetchMock).not.toHaveBeenCalled()
  })

  it('422 fallback: inline comments rejected → review re-posted body-only', async () => {
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

    expect(mocks.octokit.rest.pulls.createReview).toHaveBeenCalledTimes(2)
    const retryArgs = mocks.octokit.rest.pulls.createReview.mock.calls[1][0]
    expect(retryArgs.comments).toEqual([])
    // Pipeline continued to completion after the fallback
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})
