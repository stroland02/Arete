import express from 'express'
import { getConfig } from './config.js'
import { handlePullRequestEvent } from './webhook-handler.js'
import { handleStripeWebhook } from './stripe-handler.js'
import { handleGitLabWebhook } from './gitlab-handler.js'
import { buildOAuthAuthorizeUrl } from './oauth/build-authorize-url.js'
import { handleOAuthCallback } from './oauth/oauth-callback-handler.js'
import type { StagingSendDeps } from './staging/send.js'
import type { StagingOctokit } from './staging/stage-pr.js'

// @octokit/app and @octokit/webhooks are pure ESM (import-only "exports" maps);
// this package compiles to CJS, so they must be loaded via dynamic import(),
// which tsx/esbuild preserves as a native import at runtime.
export async function createServer(): Promise<express.Application> {
  const config = getConfig()
  const { App } = await import('@octokit/app')
  const { createNodeMiddleware } = await import('@octokit/webhooks')

  const app = new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: { secret: config.webhookSecret },
  })

  app.webhooks.on('pull_request', async ({ octokit, payload }) => {
    try {
      await handlePullRequestEvent(octokit as any, payload as any)
    } catch (err) {
      console.error('[server] Error handling pull_request event:', err)
    }
  })
  
  const { registerCheckRunWebhooks } = await import('./webhook-handler.js')
  registerCheckRunWebhooks(app)


  app.webhooks.on('pull_request_review_comment', async ({ octokit, payload }) => {
    const { handleReviewCommentEvent } = await import('./chat-handler.js')
    try {
      await handleReviewCommentEvent(octokit as any, payload as any)
    } catch (err) {
      console.error('[server] Error handling pull_request_review_comment event:', err)
    }
  })

  // Create the Installation row as soon as the app is installed, so a fresh
  // customer enters the dashboard's tenancy scope immediately (before any PR is
  // reviewed). Only affirmative actions upsert; suspend/delete are left alone
  // (deleting would cascade to repositories/reviews — destructive, out of scope).
  app.webhooks.on('installation', async ({ payload }) => {
    const affirmative = ['created', 'unsuspend', 'new_permissions_accepted']
    if (!affirmative.includes(payload.action)) return
    // account is a User/Org (has `login`) or an Enterprise (has `slug`, no login).
    const account = payload.installation.account
    const owner = account && 'login' in account ? account.login : undefined
    if (!owner) return
    let installationUuid: string | undefined
    try {
      const { persistInstallation } = await import('./persistence.js')
      installationUuid = await persistInstallation({
        provider: 'github',
        installationExternalId: payload.installation.id,
        owner,
      })
    } catch (err) {
      console.error('[server] Error handling installation event:', err)
    }

    // Backfill the repos' EXISTING open PRs so past work becomes visible
    // right away, instead of only reviewing PRs opened after install. Kept
    // in its own try/catch: a backfill failure must never be conflated with
    // (or block on) the Installation row persisted just above.
    try {
      const { getInstallationOctokit } = await import('./github-auth.js')
      const octokit = await getInstallationOctokit(app, payload.installation.id)
      const { backfillInstallationPRs } = await import('./backfill.js')
      // `repositories` is only present on some installation actions (e.g.
      // 'created'); default to [] so e.g. 'unsuspend' deliveries without it
      // are a no-op rather than a crash.
      const repos = (payload as any).repositories ?? []
      await backfillInstallationPRs(octokit as any, payload.installation.id, repos)
    } catch (err) {
      console.error('[server] Error backfilling PRs for installation:', err)
    }

    // Build the Sensorium code map right away, so the dashboard's code map is
    // populated ON CONNECT rather than only after this repo's first PR review.
    // Kept independent of the PR backfill above: neither should block or fail
    // the other, and triggerContextMapIndex is itself best-effort/fail-open.
    try {
      const repos = (payload as any).repositories ?? []
      const { triggerContextMapIndex } = await import('./context-map-index.js')
      await triggerContextMapIndex(app, payload.installation.id, repos)
    } catch (err) {
      console.error('[server] Error triggering code-map index on install:', err)
    }

    // Auto-scan on connect (work-item inbox): fire-and-forget — the trigger
    // itself gates on repo+model both present, so whichever side of the pair
    // completes last actually starts the scan. Runs AFTER the PR backfill so
    // the tenant's Repository rows exist for the repo gate. Never blocks or
    // fails the installation handler.
    if (installationUuid) {
      import('./scan/trigger.js')
        .then(({ maybeStartScan }) => maybeStartScan(installationUuid!))
        .catch((err) => console.error('[server] Error auto-triggering scan on install:', err))
    }
  })

  // A repo added to an EXISTING installation after the fact (the customer
  // grants the app access to more repos later) never fires `installation`
  // again, so without this its existing open PRs would never get backfilled.
  app.webhooks.on('installation_repositories', async ({ payload }) => {
    if (payload.action !== 'added') return
    try {
      const { getInstallationOctokit } = await import('./github-auth.js')
      const octokit = await getInstallationOctokit(app, payload.installation.id)
      const { backfillInstallationPRs } = await import('./backfill.js')
      await backfillInstallationPRs(octokit as any, payload.installation.id, payload.repositories_added as any)
      // Same as the `installation` handler: build the code map for the newly
      // added repos on connect, not just after their first PR review.
      const { triggerContextMapIndex } = await import('./context-map-index.js')
      await triggerContextMapIndex(app, payload.installation.id, payload.repositories_added as any)
    } catch (err) {
      console.error('[server] Error handling installation_repositories event:', err)
    }
  })

  const server = express()
  
  // Pre-auth Poison Message Guard: Drop empty/malformed payloads instantly
  // before they consume DB reads or queue resources.
  server.use((req, res, next) => {
    const contentLength = req.headers['content-length']
    if (contentLength !== undefined && /^\s*0+\s*$/.test(contentLength)) {
      res.status(400).send('empty request body; no records to ingest')
      return
    }
    next()
  })

  // Stripe webhook needs raw body
  server.post('/stripe-webhook', express.raw({ type: 'application/json' }), handleStripeWebhook)
  
  // GitLab webhook needs JSON body
  server.post('/gitlab-webhook', express.json(), handleGitLabWebhook)
  
  // Service-to-service surface guard: /internal/*, /scan/trigger,
  // /staging/send and /api/approvals/:id/execute are called only by our own
  // services (the dashboard proxies after session-scoping the tenant), so the
  // hop itself requires the shared bearer token (INTERNAL_API_TOKEN).
  // Fail-closed 503 when unconfigured. Public receivers (GitHub/Stripe/GitLab
  // webhooks) and the browser-facing OAuth routes are deliberately NOT behind
  // this guard.
  const { createInternalAuthMiddleware } = await import('./internal-auth.js')
  const requireInternalToken = createInternalAuthMiddleware()
  server.use('/internal', requireInternalToken)

  // Infrastructure Approvals Endpoint
  // Receives clicks from the dashboard when a human approves an LLM's
  // infrastructure command. Durably transitions the ApprovalPrompt to EXECUTED
  // and hands the command off to the `approval-exec` queue for the actual
  // apply/resume work (see approval-handler.ts). Idempotent on replay.
  // Bearer-guarded (PM ruling 2026-07-19): no caller exists yet — Wave B's fix
  // dispatcher will be the first and sends the header from day one.
  server.post('/api/approvals/:id/execute', requireInternalToken, express.json(), async (req, res) => {
    // The extra middleware in the chain widens Express's params inference to a
    // generic dictionary; the route literal guarantees `id` is a string.
    const { id } = req.params as { id: string }
    try {
      const { executeApproval } = await import('./approval-handler.js')
      const result = await executeApproval(id)
      switch (result.outcome) {
        case 'not_found':
          res.status(404).json({ error: 'approval_not_found', id })
          return
        case 'rejected':
          res.status(409).json({ error: 'approval_rejected', id, status: result.status })
          return
        case 'already_executed':
          // Idempotent replay — report the recorded state, not a fresh run.
          res.status(200).json({
            status: 'executed',
            approvalId: result.approvalId,
            executedAt: result.executedAt,
            idempotent: true,
          })
          return
        case 'executed':
          res.status(202).json({
            status: 'executed',
            approvalId: result.approvalId,
            executedAt: result.executedAt,
          })
          return
      }
    } catch (err) {
      console.error(`[approvals] Failed to execute approval ${id}:`, err)
      res.status(500).json({ error: 'internal_error', id })
    }
  })
  
  // PR-staging send seam (internal). The dashboard's "Post PR" action calls this
  // with two internal uuids; we resolve the tenant to an installation Octokit,
  // load the approved container slice, and run the gate-enforced, idempotent
  // stagePullRequest core. NEVER auto-sends — the core refuses unless the
  // container carries gates.solutionApprovedAt (server-side gate). Deps import
  // lazily so registration never pulls in @arete/db (keeps this path db-free
  // until a request actually needs a tenant lookup).
  const stagingSendDeps: StagingSendDeps = {
    async resolveExternalId(installationId) {
      const { prisma } = await import('./db.js')
      const inst = await prisma.installation.findUnique({
        where: { id: installationId },
        select: { externalId: true },
      })
      return inst?.externalId ?? null
    },
    async getOctokit(externalId) {
      const { getInstallationOctokit } = await import('./github-auth.js')
      const octokit = await getInstallationOctokit(app, externalId)
      return octokit as unknown as StagingOctokit
    },
    async loadContainer(containerId, installationId) {
      const { loadApprovedContainer } = await import('./staging/load-container.js')
      return loadApprovedContainer(containerId, installationId)
    },
  }
  const { createStagingSendHandler } = await import('./staging/send-handler.js')
  server.post('/staging/send', requireInternalToken, express.json(), createStagingSendHandler(stagingSendDeps))

  // Internal scan trigger (work-item inbox). The dashboard's session-scoped
  // POST /api/scan proxies here with a session-derived internal installation
  // uuid; the connect choke points fire it directly. All gating (repo present,
  // model present, no scan already running) lives in maybeStartScan — this
  // route only maps the result: 202 started / 409 already_running / 200
  // {started:false, reason}. Deps import lazily (db-free registration).
  server.post('/scan/trigger', requireInternalToken, express.json(), async (req, res) => {
    const installationId =
      typeof req.body?.installationId === 'string' ? req.body.installationId : ''
    if (!installationId) {
      res.status(400).json({ error: 'installationId required' })
      return
    }
    try {
      const { maybeStartScan } = await import('./scan/trigger.js')
      const result = await maybeStartScan(installationId)
      if (result.started) res.status(202).json(result)
      else if (result.reason === 'already_running') res.status(409).json(result)
      else res.status(200).json(result)
    } catch (err) {
      console.error('[scan] trigger route failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Internal model-connection Test probe. The dashboard's session-authenticated
  // /api/model-connections/test route proxies here so the SSRF-guarded outbound
  // probe (net-guard, via testModelConnection) runs in this service, not in the
  // Next.js server. Stateless: no persistence, no tenant data — validates a
  // candidate { provider, model, apiKey?, baseUrl? } and returns { ok, model?,
  // detail? }. Kept separate from the (unmounted) tenant CRUD, which stays behind
  // the dashboard's Auth.js session.
  // Internal fix trigger (healing loop). The dashboard's "Fix it" creates an
  // IssueContainer at `detecting` and fires this with the work item's id. The
  // drive runs in the background (agents /fix authors + verifies a real patch,
  // then the container advances to `ready` or `fix_failed`); we ACK 202 at once
  // so the UI can open the live stream while the container fills in. Never
  // blocks on the up-to-280s author run. Deps import lazily (db-free registration).
  server.post('/fix/trigger', requireInternalToken, express.json(), async (req, res) => {
    const workItemId = typeof req.body?.workItemId === 'string' ? req.body.workItemId : ''
    if (!workItemId) {
      res.status(400).json({ error: 'workItemId required' })
      return
    }
    const { driveFix, defaultFixTriggerDeps } = await import('./fix/trigger.js')
    // Fire-and-forget: the drive is long-running and self-persisting; a failure
    // lands the container in fix_failed on its own (never rethrown here).
    void driveFix(workItemId, defaultFixTriggerDeps(app)).catch((err) => {
      console.error(`[fix] drive failed for work item ${workItemId}:`, err)
    })
    res.status(202).json({ started: true })
  })

  const { createModelConnectionTestHandler } = await import('./model-connections/test-handler.js')
  server.post('/internal/model-connections/test', express.json(), createModelConnectionTestHandler())

  // GET /internal/context-map/file — live source text for the code map's
  // "read the code" panel, fetched from GitHub with the App installation token
  // (pr-fetcher's getContent pattern). Tenant-scoped, so unlike the stateless
  // probe above it is ONLY safe because the dashboard's session-authenticated
  // /api/code-map/file route resolves the installationId from the session and
  // proxies here server-to-server (same posture as the agents service's own
  // /context-map/graph/{id}); the browser never reaches this endpoint. The
  // path is additionally validated (isSafeRepoPath) before any GitHub call.
  const { createContextMapFileHandler } = await import('./context-map/file-handler.js')
  server.get('/internal/context-map/file', createContextMapFileHandler())

  // NOTE: the model-connection *management* API (/api/model-connections — GET list,
  // PUT upsert, DELETE, POST .../test) is deliberately NOT mounted here for the same
  // reason as the outbound-webhook management API below: it is tenant-scoped CRUD that
  // returns/mutates a customer's config, and the webhook service has no session, so an
  // unauthenticated route trusting a client-supplied installationId would let any caller
  // read or delete any tenant's connections — the exact vuln that pulled /api/webhooks/
  // endpoints. The Test ping additionally makes an outbound call to a client-supplied
  // baseUrl (SSRF-shaped) — net-guard hardens it, but it must not be an open proxy.
  // The tenant-scoped core lives in ./model-connections/ (store.ts: saveModelConnection/
  // list/get/delete, all installationId-scoped, key-free views; test-connection.ts:
  // testModelConnection). The authenticated surface belongs behind the dashboard's
  // Auth.js session, which supplies a session-derived installationId (fast-follow).
  //
  // NOTE: the outbound-webhook *management* API (POST/GET /api/webhooks/endpoints)
  // is deliberately NOT mounted here. It trusted a client-supplied installationId
  // with no authentication — an anonymous caller could register a webhook for, or
  // list the endpoints of, any tenant and receive that tenant's whsec_ secret.
  // Authenticated, tenant-scoped management belongs behind the dashboard's
  // Auth.js session (fast-follow). Endpoints are created internally / seeded via
  // PrismaWebhookStore; the delivery engine (persistence.ts) is unaffected.

  // Mount at root and let createNodeMiddleware own the path matching —
  // Express strips the mount prefix from req.url, so mounting at '/webhook'
  // would make the middleware see '/' and never match its configured path.
  server.use(createNodeMiddleware(app.webhooks, { path: '/webhook' }))

  const { handleMetricsStream } = await import('./sse-handler.js')
  server.get('/metrics/stream', handleMetricsStream)

  server.get('/oauth/:provider/authorize', (req, res) => {
    const installationId = req.query.installationId as string | undefined
    if (!installationId) {
      res.status(400).send('Missing installationId query parameter')
      return
    }
    const provider = req.params.provider as 'vercel' | 'posthog'
    const url = buildOAuthAuthorizeUrl(provider, installationId)
    res.redirect(url)
  })

  server.get('/oauth/:provider/callback', handleOAuthCallback)

  server.get('/health', (_req, res) => res.json({ status: 'ok' }))

  return server
}
