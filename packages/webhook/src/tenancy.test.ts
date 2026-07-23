/**
 * Tenancy and idempotency tests for the shared @arete/db data model.
 *
 * These tests drive the REAL handlers (webhook-handler, gitlab-handler,
 * stripe-handler) against an in-memory fake Prisma client that enforces the
 * schema's unique constraints:
 *   - Installation/Repository: @@unique([provider, externalId])
 *   - Review:                  @@unique([repositoryId, prNumber, headSha])
 *
 * They prove:
 *   1. A GitHub installation and a GitLab project with the SAME numeric
 *      external id resolve to two distinct Installation rows, and Stripe
 *      billing updates never cross between them (the cross-tenant bug).
 *   2. Re-delivering the same (repository, prNumber, headSha) webhook does
 *      not create a duplicate Review row.
 *   3. analysis_status round-trips from the pipeline result into the row.
 *   4. A GitHub payload with no installation skips persistence entirely
 *      (no garbage externalId=0 row) but still posts the review.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import type { Request, Response } from 'express'

// ---------------------------------------------------------------------------
// In-memory fake Prisma enforcing the schema's unique constraints
// ---------------------------------------------------------------------------
type Row = Record<string, any>

function createFakePrisma() {
  const installations: Row[] = []
  const repositories: Row[] = []
  const reviews: Row[] = []
  let seq = 0
  const uid = (prefix: string) => `${prefix}-uuid-${++seq}`

  const byProviderExternalId = (rows: Row[], where: any) => {
    const key = where.provider_externalId
    return rows.find((r) => r.provider === key.provider && r.externalId === key.externalId)
  }

  const prisma = {
    installation: {
      findUnique: async ({ where }: any) => byProviderExternalId(installations, where) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = byProviderExternalId(installations, where)
        if (existing) {
          Object.assign(existing, update)
          return existing
        }
        const row: Row = {
          id: uid('inst'),
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          subscriptionStatus: 'trialing',
          planTier: 'trialing',
          usageCount: 0,
          createdAt: new Date(),
          ...create,
        }
        installations.push(row)
        return row
      },
      update: async ({ where, data }: any) => {
        const row = installations.find((r) => r.id === where.id)
        if (!row) throw new Error(`Installation ${where.id} not found`)
        for (const [field, value] of Object.entries<any>(data)) {
          if (value && typeof value === 'object' && 'increment' in value) {
            row[field] += value.increment
          } else {
            row[field] = value
          }
        }
        return row
      },
      updateMany: async ({ where, data }: any) => {
        const matches = installations.filter(
          (r) =>
            (where.provider === undefined || r.provider === where.provider) &&
            (where.externalId === undefined || r.externalId === where.externalId) &&
            (where.stripeSubscriptionId === undefined || r.stripeSubscriptionId === where.stripeSubscriptionId)
        )
        for (const m of matches) Object.assign(m, data)
        return { count: matches.length }
      },
    },
    repository: {
      findUnique: async ({ where }: any) => byProviderExternalId(repositories, where) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = byProviderExternalId(repositories, where)
        if (existing) {
          Object.assign(existing, update)
          return existing
        }
        const row: Row = { id: uid('repo'), createdAt: new Date(), ...create }
        repositories.push(row)
        return row
      },
    },
    review: {
      findUnique: async ({ where }: any) => {
        const key = where.repositoryId_prNumber_headSha
        return (
          reviews.find(
            (r) =>
              r.repositoryId === key.repositoryId &&
              r.prNumber === key.prNumber &&
              r.headSha === key.headSha
          ) ?? null
        )
      },
      create: async ({ data }: any) => {
        const duplicate = reviews.find(
          (r) =>
            r.repositoryId === data.repositoryId &&
            r.prNumber === data.prNumber &&
            r.headSha === data.headSha
        )
        if (duplicate) {
          const err: any = new Error(
            'Unique constraint failed on the fields: (`repositoryId`,`prNumber`,`headSha`)'
          )
          err.code = 'P2002'
          throw err
        }
        const { comments, ...rest } = data
        const row: Row = {
          id: uid('review'),
          analysisStatus: 'complete',
          createdAt: new Date(),
          ...rest,
          comments: comments?.createMany?.data ?? [],
        }
        reviews.push(row)
        return row
      },
    },
    agentMemory: {
      findMany: async () => [],
    },
  }

  return { prisma, installations, repositories, reviews }
}

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------
const REVIEW_RESULT = {
  pr_context: { repo: 'acme/api', pr_number: 1, title: 'T', description: '', files: [] },
  file_reviews: [
    {
      path: 'src/a.ts',
      comments: [{ path: 'src/a.ts', line: 3, body: 'B', severity: 'warning', category: 'security' }],
      summary: 'S',
    },
  ],
  overall_summary: 'OK',
  risk_level: 'low',
  total_comments: 1,
}

function makeOctokit() {
  return {
    request: vi.fn().mockResolvedValue({}),
    rest: {
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        update: vi.fn().mockResolvedValue({}),
      },
    },
  }
}

function githubPayload(installationId: number | undefined, overrides: Row = {}) {
  return {
    action: 'opened',
    repository: { id: 9001, owner: { login: 'acme' }, name: 'api', full_name: 'acme/api' },
    pull_request: { number: 1, head: { sha: 'sha-github-1' } },
    ...(installationId === undefined ? {} : { installation: { id: installationId } }),
    ...overrides,
  }
}

function gitlabBody(projectId: number) {
  return {
    object_kind: 'merge_request',
    project: { id: projectId, path_with_namespace: 'globex/api' },
    object_attributes: {
      iid: 7,
      state: 'opened',
      action: 'open',
      title: 'T',
      description: '',
      diff_refs: { base_sha: 'base1', start_sha: 'start1' },
      last_commit: { id: 'sha-gitlab-1' },
    },
  }
}

function makeReqRes(headers: Record<string, string>, body: any) {
  const req = { headers, body } as unknown as Request
  const res: any = {
    statusCode: undefined,
    payload: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    send(p: any) {
      this.payload = p
      return this
    },
    json(p: any) {
      this.payload = p
      return this
    },
  }
  return { req, res: res as Response, mockRes: res }
}

type Fake = ReturnType<typeof createFakePrisma>

/**
 * Mocks every external boundary and returns the real handlers + fake store.
 *
 * The webhook handlers now only validate + enqueue a `review-pr` job (see
 * webhook-handler.ts / gitlab-handler.ts); the pipeline itself runs in
 * worker.ts's processReviewJob(). ./queue.js is mocked to capture enqueued
 * jobs instead of hitting real Redis, and drainJobs() feeds each captured
 * job into the real processReviewJob() to simulate the worker — same
 * pattern as pipeline.integration.test.ts.
 */
async function loadHandlers(fake: Fake, opts: { reviewResult?: any; stripeEvent?: () => any } = {}) {
  vi.resetModules()
  const result = opts.reviewResult ?? REVIEW_RESULT
  const capturedJobs: any[] = []

  vi.doMock('@arete/db', () => ({ PrismaClient: vi.fn(() => fake.prisma) }))
  vi.doMock('./pr-fetcher.js', () => ({ fetchPRContext: vi.fn().mockResolvedValue(REVIEW_RESULT.pr_context) }))
  vi.doMock('./review-bridge.js', () => ({ runReviewPipeline: vi.fn().mockResolvedValue(result) }))
  vi.doMock('./comment-poster.js', () => ({ postReview: vi.fn().mockResolvedValue(undefined) }))
  vi.doMock('./gitlab-fetcher.js', () => ({
    fetchGitLabMRContext: vi.fn().mockResolvedValue(REVIEW_RESULT.pr_context),
  }))
  vi.doMock('./gitlab-comment-poster.js', () => ({ postGitLabReview: vi.fn().mockResolvedValue(undefined) }))
  vi.doMock('./github-auth.js', () => ({
    createApp: vi.fn(() => ({})),
    getInstallationOctokit: vi.fn(async () => makeOctokit()),
    getInstallationToken: vi.fn(async () => 'ghs_test_token'),
  }))
  vi.doMock('./queue.js', () => ({
    enqueueReviewJob: vi.fn(async (data: any) => {
      capturedJobs.push(data)
      return { id: `job-${capturedJobs.length}` }
    }),
    REVIEW_QUEUE_NAME: 'review-pr',
    REVIEW_QUEUE_CONCURRENCY: 5,
  }))
  vi.doMock('stripe', () => {
    class FakeStripe {
      webhooks = {
        constructEvent: () => {
          if (!opts.stripeEvent) throw new Error('No stripe event configured in test')
          return opts.stripeEvent()
        },
      }
    }
    return { default: FakeStripe }
  })

  const { handlePullRequestEvent } = await import('./webhook-handler.js')
  const { handleGitLabWebhook } = await import('./gitlab-handler.js')
  const { handleStripeWebhook } = await import('./stripe-handler.js')
  const { postReview } = (await import('./comment-poster.js')) as any
  const { processReviewJob } = await import('./worker.js')

  /** Simulates the worker draining every job enqueued so far, in order. */
  async function drainJobs(): Promise<void> {
    while (capturedJobs.length > 0) {
      const job = capturedJobs.shift()
      await processReviewJob(job)
    }
  }

  return { handlePullRequestEvent, handleGitLabWebhook, handleStripeWebhook, postReview, capturedJobs, drainJobs }
}

// Warm vite's transform cache before any test is timed.
//
// loadHandlers() has to run INSIDE each test — it takes per-test mock config —
// and its first call pays the cold transform of the whole handler graph
// (webhook-handler -> worker -> ...). Measured: ~2.4s in isolation, ~3.9s under
// full-suite CPU contention. Every later call is nearly free, because
// vi.resetModules() clears the module REGISTRY, not vite's TRANSFORM CACHE.
//
// Charged to the first test, that 3.9s sat inside vitest's 5s testTimeout with
// ~1.1s of headroom, and crossed it whenever another package's suite ran
// concurrently — the intermittent "tenancy.test.ts is flaky" failures that have
// been dismissed as load noise more than once. This is not a timeout bump: the
// work is setup, so it is charged to setup, where hookTimeout (10s) applies, and
// each test is left measuring only its own behaviour.
//
// It goes through loadHandlers rather than a bare import so every vi.doMock is
// applied first — a raw import of ./worker.js would construct the real Prisma
// client and the real queue.
beforeAll(async () => {
  vi.stubEnv('GITLAB_WEBHOOK_SECRET', 'gl-secret')
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake')
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fake')
  await loadHandlers(createFakePrisma())
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('tenancy: provider-scoped installations', () => {
  beforeEach(() => {
    vi.stubEnv('GITLAB_WEBHOOK_SECRET', 'gl-secret')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fake')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('a GitHub installation and a GitLab project with the SAME external id are two distinct rows, and Stripe billing never crosses between them', async () => {
    const fake = createFakePrisma()
    const COLLIDING_ID = 777

    const handlers = await loadHandlers(fake, {
      stripeEvent: () => ({
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: String(COLLIDING_ID),
            customer: 'cus_github_customer',
            subscription: 'sub_github_subscription',
          },
        },
      }),
    })

    // GitHub PR review for installation 777
    await handlers.handlePullRequestEvent(makeOctokit() as any, githubPayload(COLLIDING_ID) as any)

    // GitLab MR review for project 777
    const { req, res } = makeReqRes({ 'x-gitlab-token': 'gl-secret' }, gitlabBody(COLLIDING_ID))
    await handlers.handleGitLabWebhook(req, res)

    // Both handlers only enqueued so far — simulate the worker draining them.
    await handlers.drainJobs()
    expect(fake.installations).toHaveLength(2)

    // Two distinct rows despite identical numeric external ids
    const github = fake.installations.find((i) => i.provider === 'github')
    const gitlab = fake.installations.find((i) => i.provider === 'gitlab')
    expect(github).toBeDefined()
    expect(gitlab).toBeDefined()
    expect(github!.id).not.toBe(gitlab!.id)
    expect(github!.externalId).toBe(COLLIDING_ID)
    expect(gitlab!.externalId).toBe(COLLIDING_ID)

    // Stripe checkout completion for GitHub installation 777 must only touch
    // the GitHub row — this was the cross-tenant billing bug.
    const stripeReq = makeReqRes({ 'stripe-signature': 'sig' }, {})
    await handlers.handleStripeWebhook(stripeReq.req, stripeReq.res)

    expect(github!.stripeCustomerId).toBe('cus_github_customer')
    expect(github!.subscriptionStatus).toBe('active')
    expect(gitlab!.stripeCustomerId).toBeNull()
    expect(gitlab!.stripeSubscriptionId).toBeNull()
    expect(gitlab!.subscriptionStatus).toBe('trialing')
  })

  it('billing gate looks up installations scoped by provider, so a canceled GitLab row cannot pause a GitHub customer', async () => {
    const fake = createFakePrisma()
    // Pre-seed a CANCELED GitLab installation with external id 777
    fake.installations.push({
      id: 'gitlab-row',
      provider: 'gitlab',
      externalId: 777,
      owner: 'globex',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionStatus: 'canceled',
      planTier: 'trialing',
      usageCount: 0,
      createdAt: new Date(),
    })

    const handlers = await loadHandlers(fake)
    const octokit = makeOctokit()
    await handlers.handlePullRequestEvent(octokit as any, githubPayload(777) as any)
    await handlers.drainJobs()

    // The review ran — it was NOT paused by the GitLab row's canceled status
    expect(handlers.postReview).toHaveBeenCalledTimes(1)
    expect(octokit.request).not.toHaveBeenCalled()
  })
})

describe('idempotency: (repositoryId, prNumber, headSha)', () => {
  beforeEach(() => vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake'))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('delivering the same PR webhook twice creates exactly one Review row and counts usage once', async () => {
    const fake = createFakePrisma()
    const handlers = await loadHandlers(fake)

    await handlers.handlePullRequestEvent(makeOctokit() as any, githubPayload(777) as any)
    await handlers.drainJobs()
    // Second delivery: the early reviewExists() check in handlePullRequestEvent
    // should skip enqueueing entirely — nothing left for drainJobs to do.
    await handlers.handlePullRequestEvent(makeOctokit() as any, githubPayload(777) as any)
    expect(handlers.capturedJobs).toHaveLength(0)
    await handlers.drainJobs()

    expect(fake.reviews).toHaveLength(1)
    expect(fake.installations).toHaveLength(1)
    expect(fake.installations[0].usageCount).toBe(1)
  })

  it('a new head SHA on the same PR creates a second Review row', async () => {
    const fake = createFakePrisma()
    const handlers = await loadHandlers(fake)

    await handlers.handlePullRequestEvent(makeOctokit() as any, githubPayload(777) as any)
    await handlers.drainJobs()
    await handlers.handlePullRequestEvent(
      makeOctokit() as any,
      githubPayload(777, { pull_request: { number: 1, head: { sha: 'sha-github-2' } } }) as any
    )
    await handlers.drainJobs()

    expect(fake.reviews).toHaveLength(2)
    expect(fake.installations[0].usageCount).toBe(2)
  })
})

describe('analysisStatus persistence', () => {
  beforeEach(() => vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake'))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('round-trips analysis_status: "failed" from the pipeline result into the Review row', async () => {
    const fake = createFakePrisma()
    const handlers = await loadHandlers(fake, {
      reviewResult: { ...REVIEW_RESULT, analysis_status: 'failed' },
    })

    await handlers.handlePullRequestEvent(makeOctokit() as any, githubPayload(777) as any)
    await handlers.drainJobs()

    expect(fake.reviews).toHaveLength(1)
    expect(fake.reviews[0].analysisStatus).toBe('failed')
    expect(fake.reviews[0].headSha).toBe('sha-github-1')
  })

  it('defaults to "complete" when the pipeline omits analysis_status', async () => {
    const fake = createFakePrisma()
    const handlers = await loadHandlers(fake)

    await handlers.handlePullRequestEvent(makeOctokit() as any, githubPayload(777) as any)
    await handlers.drainJobs()

    expect(fake.reviews[0].analysisStatus).toBe('complete')
  })
})

describe('missing installation id', () => {
  beforeEach(() => vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake'))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('does NOT create an Installation row (no externalId=0 garbage) and does not enqueue a review job', async () => {
    const fake = createFakePrisma()
    const handlers = await loadHandlers(fake)
    const octokit = makeOctokit()

    // Without an installation id, the worker has no way to obtain an
    // installation-scoped octokit for this job (a separate process — it
    // can't reuse the octokit instance the webhook handler was called
    // with), so handlePullRequestEvent must not enqueue anything at all
    // rather than enqueueing an unrunnable job.
    await expect(
      handlers.handlePullRequestEvent(octokit as any, githubPayload(undefined) as any)
    ).resolves.toBeUndefined()

    expect(handlers.capturedJobs).toHaveLength(0)
    await handlers.drainJobs()

    expect(handlers.postReview).not.toHaveBeenCalled()
    expect(fake.installations).toHaveLength(0)
    expect(fake.repositories).toHaveLength(0)
    expect(fake.reviews).toHaveLength(0)
  })
})
