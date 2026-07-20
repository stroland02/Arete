import { describe, it, expect, vi } from 'vitest'
import { createFixTriggerHandler, type FixTriggerDeps } from './trigger-handler.js'

// Express-free harness: the handler only touches req.body and res.status/json.
function call(handler: ReturnType<typeof createFixTriggerHandler>, body: unknown) {
  const req = { body } as never
  const res = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(p: unknown) {
      this.payload = p
      return this
    },
  }
  return Promise.resolve(handler(req, res as never, vi.fn())).then(() => res)
}

describe('POST /fix/trigger handler', () => {
  const fixing = { id: 'wi-1', state: 'fixing', containerId: 'cont-1' }

  it('400s without a workItemId', async () => {
    const deps: FixTriggerDeps = { loadWorkItem: vi.fn(), enqueue: vi.fn() }
    const res = await call(createFixTriggerHandler(deps), {})
    expect(res.statusCode).toBe(400)
    expect(deps.enqueue).not.toHaveBeenCalled()
  })

  it('404s an unknown work item', async () => {
    const deps: FixTriggerDeps = { loadWorkItem: vi.fn(async () => null), enqueue: vi.fn() }
    const res = await call(createFixTriggerHandler(deps), { workItemId: 'nope' })
    expect(res.statusCode).toBe(404)
    expect(deps.enqueue).not.toHaveBeenCalled()
  })

  it('409s an item that is not mid-fix (state or container missing)', async () => {
    const deps: FixTriggerDeps = {
      loadWorkItem: vi.fn(async () => ({ id: 'wi-1', state: 'open', containerId: null })),
      enqueue: vi.fn(),
    }
    const res = await call(createFixTriggerHandler(deps), { workItemId: 'wi-1' })
    expect(res.statusCode).toBe(409)
    expect(deps.enqueue).not.toHaveBeenCalled()
  })

  it('202s and enqueues exactly { workItemId } for a fixing item', async () => {
    const deps: FixTriggerDeps = {
      loadWorkItem: vi.fn(async () => fixing),
      enqueue: vi.fn(async () => ({})),
    }
    const res = await call(createFixTriggerHandler(deps), { workItemId: 'wi-1' })
    expect(res.statusCode).toBe(202)
    expect(deps.enqueue).toHaveBeenCalledWith({ workItemId: 'wi-1' })
  })

  it('500s (never throws) when the queue is down', async () => {
    const deps: FixTriggerDeps = {
      loadWorkItem: vi.fn(async () => fixing),
      enqueue: vi.fn(async () => {
        throw new Error('redis down')
      }),
    }
    const res = await call(createFixTriggerHandler(deps), { workItemId: 'wi-1' })
    expect(res.statusCode).toBe(500)
  })
})
