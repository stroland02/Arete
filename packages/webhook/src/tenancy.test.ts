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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

/** Mocks every external boundary and returns the real handlers + fake store. */
async function loadHandlers(fake: Fake, opts: { reviewResult?: any; stripeEvent?: () => any } = {}) {
  vi.resetModules()
  const result = opts.reviewResult ?? REVIEW_RESULT

  vi.doMock('@arete/db', () => ({ PrismaClient: vi.fn(() => fake.prisma) }))
  vi.doMock('./pr-fetcher.js', () => ({ fetchPRContext: vi.fn().mockResolvedValue(REVIEW_RESULT.pr_context) }))
  vi.doMock('./review-bridge.js', () => ({ runReviewPipeline: vi.fn().mockResolvedValue(result) }))
  vi.doMock('./comment-poster.js', () => ({ postReview: vi.fn().mockResolvedValue(undefined) }))
  vi.doMock('./gitlab-fetcher.js', () => ({
    fetchGitLabMRContext: vi.fn().mockResolvedValue(REVIEW_RESULT.pr_context),
  }))
  vi.doMock('./gitlab-comment-poster.js', () => ({ postGitLabReview: vi.fn().mockResolvedValue(undefined) }))
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
  return { handlePullRequestEvent, handleGitLabWebhook, handleStripeWebhook, postReview }
}

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

    // GitLab MR review for project 777 (fire-and-forget inside the handler)
    const { req, res } = makeReqRes({ 'x-gitlab-token': 'gl-secret' }, gitlabBody(COLLIDING_ID))
    await handlers.handleGitLabWebhook(req, res)
    await vi.waitFor(() => expect(fake.installations).toHaveLength(2))

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
    await handlers.handlePullRequestEvent(makeOctokit() as any, githubPayload(777) as any)

    expect(fake.reviews).toHaveLength(1)
    expect(fake.installations).toHaveLength(1)
    expect(fake.installations[0].usageCount).toBe(1)
  })

  it('a new head SHA on the same PR creates a second Review row', async () => {
    const fake = createFakePrisma()
    const handlers = await loadHandlers(fake)

    await handlers.handlePullRequestEvent(makeOctokit() as any, githubPayload(777) as any)
    await handlers.handlePullRequestEvent(
      makeOctokit() as any,
      githubPayload(777, { pull_request: { number: 1, head: { sha: 'sha-github-2' } } }) as any
    )

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

    expect(fake.reviews).toHaveLength(1)
    expect(fake.reviews[0].analysisStatus).toBe('failed')
    expect(fake.reviews[0].headSha).toBe('sha-github-1')
  })

  it('defaults to "complete" when the pipeline omits analysis_status', async () => {
    const fake = createFakePrisma()
    const handlers = await loadHandlers(fake)

    await handlers.handlePullRequestEvent(makeOctokit() as any, githubPayload(777) as any)

    expect(fake.reviews[0].analysisStatus).toBe('complete')
  })
})

describe('missing installation id', () => {
  beforeEach(() => vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake'))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('does NOT create an Installation row (no externalId=0 garbage) and still posts the review', async () => {
    const fake = createFakePrisma()
    const handlers = await loadHandlers(fake)
    const octokit = makeOctokit()

    await expect(
      handlers.handlePullRequestEvent(octokit as any, githubPayload(undefined) as any)
    ).resolves.toBeUndefined()

    expect(handlers.postReview).toHaveBeenCalledTimes(1)
    expect(fake.installations).toHaveLength(0)
    expect(fake.repositories).toHaveLength(0)
    expect(fake.reviews).toHaveLength(0)
  })
})
