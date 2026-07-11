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

  const server = express()
  
  // Stripe webhook needs raw body
  server.post('/stripe-webhook', express.raw({ type: 'application/json' }), handleStripeWebhook)
  
  // GitLab webhook needs JSON body
  server.post('/gitlab-webhook', express.json(), handleGitLabWebhook)
  
  // Mount at root and let createNodeMiddleware own the path matching —
  // Express strips the mount prefix from req.url, so mounting at '/webhook'
  // would make the middleware see '/' and never match its configured path.
  server.use(createNodeMiddleware(app.webhooks, { path: '/webhook' }))

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
