// The HTTP skin over fix-run dispatch (healing loop, spec 2026-07-19 §2/§6).
// Internal endpoint under the shared bearer guard: the dashboard's
// session-scoped fix route calls it AFTER creating the detecting container and
// marking the item `fixing`. The body carries ONLY workItemId — installation
// and container identity are re-derived from the stored row, so a forged body
// can never cross tenants or point the worker at someone else's container.

import type { RequestHandler } from 'express'

export interface FixTriggerDeps {
  loadWorkItem(id: string): Promise<{ id: string; state: string; containerId: string | null } | null>
  enqueue(data: { workItemId: string }): Promise<unknown>
}

export function defaultFixTriggerDeps(): FixTriggerDeps {
  return {
    async loadWorkItem(id) {
      const { prisma } = await import('../db.js')
      return prisma.workItem.findUnique({
        where: { id },
        select: { id: true, state: true, containerId: true },
      })
    },
    async enqueue(data) {
      const { enqueueFixJob } = await import('../queue.js')
      return enqueueFixJob(data)
    },
  }
}

export function createFixTriggerHandler(deps: FixTriggerDeps = defaultFixTriggerDeps()): RequestHandler {
  return async (req, res) => {
    const workItemId = typeof req.body?.workItemId === 'string' ? req.body.workItemId : ''
    if (!workItemId) {
      res.status(400).json({ error: 'workItemId required' })
      return
    }
    try {
      const item = await deps.loadWorkItem(workItemId)
      if (!item) {
        res.status(404).json({ error: 'not_found' })
        return
      }
      // Only an item the fix route just put into `fixing` (with its container
      // created) is dispatchable — anything else is a stale or forged call.
      if (item.state !== 'fixing' || !item.containerId) {
        res.status(409).json({ error: 'not_dispatchable', state: item.state })
        return
      }
      await deps.enqueue({ workItemId })
      res.status(202).json({ enqueued: true })
    } catch (err) {
      console.error('[fix] trigger route failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  }
}
