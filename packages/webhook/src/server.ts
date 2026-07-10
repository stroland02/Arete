import express from 'express'
import { getConfig } from './config.js'
import { handlePullRequestEvent } from './webhook-handler.js'

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

  const server = express()
  server.use('/webhook', createNodeMiddleware(app.webhooks, { path: '/webhook' }))
  server.get('/health', (_req, res) => res.json({ status: 'ok' }))

  return server
}
