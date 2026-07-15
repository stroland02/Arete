import express from 'express'
import { getConfig } from './config.js'
import { handlePullRequestEvent } from './webhook-handler.js'
import { handleStripeWebhook } from './stripe-handler.js'
import { handleGitLabWebhook } from './gitlab-handler.js'
import { buildOAuthAuthorizeUrl } from './oauth/build-authorize-url.js'
import { handleOAuthCallback } from './oauth/oauth-callback-handler.js'
import { prisma } from './db.js'
import { PrismaWebhookStore, type WebhookPrismaClient } from './outbound/prisma-store.js'
import { createWebhookRouter } from './outbound/routes.js'

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
    try {
      const { persistInstallation } = await import('./persistence.js')
      await persistInstallation({
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
  
  // Infrastructure Approvals Endpoint
  // Receives clicks from the dashboard when a human approves an LLM's
  // infrastructure command. Durably transitions the ApprovalPrompt to EXECUTED
  // and hands the command off to the `approval-exec` queue for the actual
  // apply/resume work (see approval-handler.ts). Idempotent on replay.
  server.post('/api/approvals/:id/execute', express.json(), async (req, res) => {
    const { id } = req.params
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
  
  // Outbound webhook management API (tenant-scoped by installationId). Backed by
  // the Prisma store; the router validates the destination URL against the SSRF
  // guard and returns the signing secret exactly once at create.
  const webhookStore = new PrismaWebhookStore(prisma as unknown as WebhookPrismaClient)
  server.use('/api/webhooks', createWebhookRouter(webhookStore))

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
