import express from 'express'
import { getConfig } from './config.js'
import { handlePullRequestEvent } from './webhook-handler.js'
import { handleStripeWebhook } from './stripe-handler.js'
import { handleGitLabWebhook } from './gitlab-handler.js'
import { buildOAuthAuthorizeUrl } from './oauth/build-authorize-url.js'
import { handleOAuthCallback } from './oauth/oauth-callback-handler.js'

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
  // Receives clicks from the dashboard when a human approves an LLM's infrastructure command.
  server.post('/api/approvals/:id/execute', express.json(), async (req, res) => {
    const { id } = req.params;
    // 1. Fetch ApprovalPrompt from DB
    // 2. Spawn secure docker sandbox to execute the saved command
    // 3. Resume the waiting LangGraph session with the stdout results
    console.log(`[approvals] Executing infrastructure command for approval ${id}...`)
    res.json({ status: 'executing' })
  })
  
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
