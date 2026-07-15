import { assertPublicWebhookUrl, WebhookDestinationError } from '@arete/net-guard'
import express from 'express'
import type { WebhookEvent } from './payload.js'
import { toPublicEndpoint, type WebhookStore } from './store.js'

// Management API for outbound webhook endpoints, tenant-scoped by installationId.
// Injected with a WebhookStore so it's driven end-to-end in tests with the
// in-memory store and runs on Prisma in production.
//
// Security posture:
//  • the whsec_ secret is returned exactly ONCE, in the create response; list
//    responses strip it (toPublicEndpoint).
//  • the destination URL is validated against the SSRF guard at registration,
//    the same guard that re-checks and IP-pins on every delivery.

const VALID_EVENTS: readonly WebhookEvent[] = ['review.created', 'review.updated']

export function createWebhookRouter(store: WebhookStore): express.Router {
  const router = express.Router()
  router.use(express.json())

  router.post('/endpoints', async (req, res) => {
    const body = (req.body ?? {}) as { installationId?: unknown; url?: unknown; events?: unknown }

    if (typeof body.installationId !== 'string' || body.installationId === '') {
      res.status(400).json({ error: 'installationId is required' })
      return
    }
    if (typeof body.url !== 'string' || body.url === '') {
      res.status(400).json({ error: 'url is required' })
      return
    }

    const events =
      Array.isArray(body.events) && body.events.length > 0
        ? (body.events as unknown[])
        : [...VALID_EVENTS]
    if (!events.every((e): e is WebhookEvent => VALID_EVENTS.includes(e as WebhookEvent))) {
      res.status(400).json({ error: `events must be a subset of ${VALID_EVENTS.join(', ')}` })
      return
    }

    // SSRF validation at registration (the same guard re-runs on every delivery).
    try {
      await assertPublicWebhookUrl(body.url)
    } catch (err) {
      if (err instanceof WebhookDestinationError) {
        res.status(400).json({ error: err.message })
        return
      }
      throw err
    }

    const endpoint = await store.createEndpoint({
      installationId: body.installationId,
      url: body.url,
      events: events as WebhookEvent[],
    })

    // The ONE and only time the secret is returned.
    res.status(201).json({
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      enabled: endpoint.enabled,
      secret: endpoint.secret,
    })
  })

  router.get('/endpoints', async (req, res) => {
    const installationId = req.query.installationId
    if (typeof installationId !== 'string' || installationId === '') {
      res.status(400).json({ error: 'installationId query parameter is required' })
      return
    }
    const endpoints = await store.listEndpoints(installationId)
    res.json(endpoints.map(toPublicEndpoint))
  })

  return router
}
