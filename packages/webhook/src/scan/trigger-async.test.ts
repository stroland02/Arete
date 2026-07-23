import { describe, expect, it, vi } from 'vitest'

import { executeScanRequest, type ScanRequestBody } from './trigger.js'

/**
 * The ack-and-poll transport for scans (M1).
 *
 * Driven through an injectable fetchFn rather than a live server: what is under
 * test here is the protocol — which call is made when, and what each answer
 * must mean — not the socket. The unknown that severs long-lived connections
 * cannot be reproduced in a unit test at all; the defence against it is the
 * shape itself (no connection outlives a poll), and these tests pin that shape.
 */

const BODY: ScanRequestBody = { installationId: 42, repoSlug: 'acme/shop', llm: {} as never }

function resp(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/** A fetchFn that answers from a scripted queue and records every call. */
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

const COMPLETE = { status: 'complete', findings: [{ title: 'raw sql' }] }

describe('executeScanRequest', () => {
  it('submits async, polls until terminal, and returns the findings', async () => {
    const { fetchFn, calls } = scripted(
      resp(200, { status: 'accepted', runId: 'r1' }),
      resp(200, { status: 'running' }),
      resp(200, { status: 'running' }),
      resp(200, COMPLETE),
    )

    const result = await executeScanRequest('http://agents', BODY, headers, { ...FAST, fetchFn })

    expect(result.status).toBe('complete')
    expect(result.findings[0]).toMatchObject({ title: 'raw sql' })
    // The submit carries mode: "async" — without it the agents service blocks
    // for the whole scan and the shape has changed nothing.
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ mode: 'async' })
    expect(calls.slice(1).every((c) => c.url.includes('/scan/runs/r1'))).toBe(true)
  })

  it('passes a synchronous answer straight through — the reversibility fallback', async () => {
    // An agents service that predates `mode` ignores the field and answers
    // with the findings. That must keep working, or the migration cannot be
    // rolled back one service at a time.
    const { fetchFn, calls } = scripted(resp(200, COMPLETE))

    const result = await executeScanRequest('http://agents', BODY, headers, { ...FAST, fetchFn })

    expect(result.status).toBe('complete')
    expect(calls).toHaveLength(1)
  })

  it('reports the agents-side failure reason, not a generic error', async () => {
    const { fetchFn } = scripted(
      resp(200, { status: 'accepted', runId: 'r1' }),
      resp(200, { status: 'failed', error: 'no cached checkout for acme/shop yet' }),
    )
    await expect(
      executeScanRequest('http://agents', BODY, headers, { ...FAST, fetchFn }),
    ).rejects.toThrow(/no cached checkout/)
  })

  it('treats a 404 for a known run as the agents service having restarted', async () => {
    // The registry over there is in-memory. Reading this as "still running"
    // would poll forever against a run that no longer exists anywhere.
    const { fetchFn } = scripted(
      resp(200, { status: 'accepted', runId: 'r1' }),
      resp(404, { detail: 'unknown scan run' }),
    )
    await expect(
      executeScanRequest('http://agents', BODY, headers, { ...FAST, fetchFn }),
    ).rejects.toThrow(/restarted mid-scan/)
  })

  it('survives a transient poll failure — one bad poll is not a failed scan', async () => {
    const { fetchFn } = scripted(
      resp(200, { status: 'accepted', runId: 'r1' }),
      resp(500, { error: 'proxy hiccup' }),
      resp(200, COMPLETE),
    )
    const result = await executeScanRequest('http://agents', BODY, headers, { ...FAST, fetchFn })
    expect(result.status).toBe('complete')
  })

  it('gives up at the deadline instead of polling forever', async () => {
    const calls: string[] = []
    const fetchFn = (async (url: unknown) => {
      calls.push(String(url))
      return calls.length === 1
        ? resp(200, { status: 'accepted', runId: 'r1' })
        : resp(200, { status: 'running' })
    }) as typeof fetch

    await expect(
      executeScanRequest('http://agents', BODY, headers, {
        fetchFn,
        pollIntervalMs: 1,
        deadlineMs: 30,
      }),
    ).rejects.toThrow(/exceeded the 30ms deadline/)
  })

  it('surfaces a rejected submit with its status and body', async () => {
    const { fetchFn } = scripted(resp(503, 'ollama unreachable: pull the model'))
    await expect(
      executeScanRequest('http://agents', BODY, headers, { ...FAST, fetchFn }),
    ).rejects.toThrow(/503/)
  })

  it('mints headers per request, because a scan can outlive one internal token', async () => {
    const headersFn = vi.fn(async () => ({ authorization: 'Bearer fresh' }))
    const { fetchFn } = scripted(
      resp(200, { status: 'accepted', runId: 'r1' }),
      resp(200, { status: 'running' }),
      resp(200, COMPLETE),
    )
    await executeScanRequest('http://agents', BODY, headersFn, { ...FAST, fetchFn })
    expect(headersFn).toHaveBeenCalledTimes(3)
  })
})
