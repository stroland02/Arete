import { describe, expect, it, vi } from 'vitest'

import { executeReviewRequest } from './review-bridge.js'
import type { PRContext, ReviewResult } from './types.js'

/**
 * The ack-and-poll transport for reviews (M1, review half) — twin of the scan's
 * trigger-async tests. Driven through an injectable fetchFn: what is under test
 * is the protocol, not the socket. The ~300s sever cannot be reproduced in a
 * unit test; the defence against it is the shape (no connection outlives a
 * poll), and these pin that shape.
 */

const CTX = { repo: 'acme/api', pr_number: 1, title: 't', description: 'd', files: [] } as PRContext

const RESULT = {
  file_reviews: [
    { path: 'a.ts', comments: [{ path: 'a.ts', line: 1, body: 'x', severity: 'error', category: 'security' }] },
  ],
  overall_summary: 'one issue',
  risk_level: 'high',
} as unknown as ReviewResult

function resp(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function scripted(...queue: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const next = queue.shift()
    if (!next) throw new Error('scripted fetch queue is empty')
    return next
  }) as typeof fetch
  return { fetchFn, calls }
}

const headers = async () => ({ authorization: 'Bearer internal' })
const FAST = { pollIntervalMs: 1, deadlineMs: 2_000 }

describe('executeReviewRequest', () => {
  it('submits async, polls until complete, and returns the review result', async () => {
    const { fetchFn, calls } = scripted(
      resp(200, { status: 'accepted', runId: 'r1' }),
      resp(200, { status: 'running' }),
      resp(200, { status: 'complete', result: RESULT }),
    )

    const result = await executeReviewRequest('http://agents', CTX, headers, { ...FAST, fetchFn })

    expect(result.risk_level).toBe('high')
    expect(result.file_reviews[0].comments[0].category).toBe('security')
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ mode: 'async' })
    expect(calls.slice(1).every((c) => c.url.includes('/review/runs/r1'))).toBe(true)
  })

  it('passes a synchronous review straight through — the reversibility fallback', async () => {
    // An agents service predating async mode returns the ReviewResult inline;
    // that must keep working, or the migration cannot roll back one service at a
    // time. Detected by the presence of file_reviews rather than a runId.
    const { fetchFn, calls } = scripted(resp(200, RESULT))
    const result = await executeReviewRequest('http://agents', CTX, headers, { ...FAST, fetchFn })
    expect(result.risk_level).toBe('high')
    expect(calls).toHaveLength(1)
  })

  it('reports the agents-side failure reason', async () => {
    const { fetchFn } = scripted(
      resp(200, { status: 'accepted', runId: 'r1' }),
      resp(200, { status: 'failed', error: 'ollama unreachable' }),
    )
    await expect(
      executeReviewRequest('http://agents', CTX, headers, { ...FAST, fetchFn }),
    ).rejects.toThrow(/ollama unreachable/)
  })

  it('treats a 404 for a known run as the agents service having restarted', async () => {
    const { fetchFn } = scripted(
      resp(200, { status: 'accepted', runId: 'r1' }),
      resp(404, { detail: 'unknown review run' }),
    )
    await expect(
      executeReviewRequest('http://agents', CTX, headers, { ...FAST, fetchFn }),
    ).rejects.toThrow(/restarted mid-review/)
  })

  it('survives a transient poll failure', async () => {
    const { fetchFn } = scripted(
      resp(200, { status: 'accepted', runId: 'r1' }),
      resp(500, { error: 'proxy hiccup' }),
      resp(200, { status: 'complete', result: RESULT }),
    )
    const result = await executeReviewRequest('http://agents', CTX, headers, { ...FAST, fetchFn })
    expect(result.risk_level).toBe('high')
  })

  it('gives up at the deadline instead of polling forever', async () => {
    const fetchFn = (async (url: unknown) =>
      String(url).endsWith('/review')
        ? resp(200, { status: 'accepted', runId: 'r1' })
        : resp(200, { status: 'running' })) as typeof fetch

    await expect(
      executeReviewRequest('http://agents', CTX, headers, { fetchFn, pollIntervalMs: 1, deadlineMs: 30 }),
    ).rejects.toThrow(/exceeded the 30ms deadline/)
  })

  it('surfaces a rejected submit with its status and body', async () => {
    const { fetchFn } = scripted(resp(503, 'ollama unreachable: pull the model'))
    await expect(
      executeReviewRequest('http://agents', CTX, headers, { ...FAST, fetchFn }),
    ).rejects.toThrow(/status 503/)
  })

  it('mints headers per request, because a review can outlive one internal token', async () => {
    const headersFn = vi.fn(async () => ({ authorization: 'Bearer fresh' }))
    const { fetchFn } = scripted(
      resp(200, { status: 'accepted', runId: 'r1' }),
      resp(200, { status: 'running' }),
      resp(200, { status: 'complete', result: RESULT }),
    )
    await executeReviewRequest('http://agents', CTX, headersFn, { ...FAST, fetchFn })
    expect(headersFn).toHaveBeenCalledTimes(3)
  })
})
