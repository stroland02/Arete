import { describe, it, expect } from 'vitest'
import { Writable } from 'node:stream'
import { createLogger } from './logger.js'

const CANARY = 'ghs_FakeLogCanary1234567890abcdef'

function collect(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk))
      cb()
    },
  })
  return { stream, lines: () => chunks.join('').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}

describe('createLogger (canary scrub — log sink, spec §6 gate 2)', () => {
  it('redacts blocklisted keys at every level', () => {
    const { stream, lines } = collect()
    const log = createLogger('webhook', { destination: stream })
    log.info(
      {
        authorization: `Bearer ${CANARY}`,
        installationToken: CANARY,
        req: { headers: { 'x-api-key': CANARY, cookie: `session=${CANARY}` } },
        nested: { token: CANARY },
      },
      'boot'
    )
    const [line] = lines()
    const raw = JSON.stringify(line)
    expect(raw).not.toContain(CANARY)
    expect(line.authorization).toBe('[REDACTED]')
  })

  it('redacts secret-shaped substrings embedded in a value, not just blocklisted keys (err.message)', () => {
    const { stream, lines } = collect()
    const log = createLogger('webhook', { destination: stream })
    const err = new Error('call failed: key sk-ant-CANARY123 rejected')
    log.error({ err, note: `also embedded here: sk-ant-CANARY123` }, 'request failed')
    const [line] = lines()
    const raw = JSON.stringify(line)
    expect(raw).not.toContain('sk-ant-CANARY123')
    expect(raw).toContain('[REDACTED]')
    expect((line.err as { message: string }).message).toContain('[REDACTED]')
    expect(line.note).toContain('[REDACTED]')
  })

  // §3 invariant: this runs inside the caller's catch block, so a throw here
  // converts a handled error into an unhandled one and can fail a whole review.
  // Both shapes below crashed or corrupted under the previous
  // `new value.constructor(message)` reconstruction.
  it('survives an Error subclass whose constructor is not (message) — Octokit shape', () => {
    const { stream, lines } = collect()
    const log = createLogger('webhook', { destination: stream })
    class RequestErrorLike extends Error {
      status: number
      constructor(message: string, status: number, options: { response?: unknown }) {
        super(message)
        this.name = 'HttpError'
        this.status = status
        // The line that threw: reconstructing with only a message left
        // `options` undefined, and `in` on undefined is a TypeError.
        if ('response' in options) this.status = status
      }
    }
    const err = new RequestErrorLike('403 rate limited, key sk-ant-CANARY123', 403, {})
    expect(() => log.error({ err, path: '.arete.yml' }, 'Error fetching file')).not.toThrow()
    const raw = JSON.stringify(lines()[0])
    expect(raw).not.toContain('sk-ant-CANARY123')
    expect(raw).toContain('[REDACTED]')
    expect(raw).toContain('HttpError')
  })

  it('survives AggregateError without splaying its message into characters', () => {
    const { stream, lines } = collect()
    const log = createLogger('webhook', { destination: stream })
    const err = new AggregateError(
      [new Error('inner a'), new Error('inner b')],
      'all providers failed: sk-ant-CANARY123'
    )
    expect(() => log.error({ err }, 'fanout failed')).not.toThrow()
    const line = lines()[0]
    const raw = JSON.stringify(line)
    expect(raw).not.toContain('sk-ant-CANARY123')
    const message = (line.err as { message: string }).message
    expect(message).toContain('[REDACTED]')
    expect(message).not.toBe('') // previously lost entirely
  })

  it('drops the payload instead of throwing if scrubbing itself fails', () => {
    const { stream, lines } = collect()
    const log = createLogger('webhook', { destination: stream })
    const hostile = {
      get boom(): string {
        throw new Error('getter explodes during scrub')
      },
    }
    expect(() => log.error({ hostile }, 'hostile payload')).not.toThrow()
    const raw = JSON.stringify(lines()[0])
    expect(raw).toContain('scrubbing failed')
  })

  it('stamps service and passes structured component through child()', () => {
    const { stream, lines } = collect()
    const log = createLogger('webhook', { destination: stream }).child({ component: 'worker' })
    log.info({ prNumber: 42 }, 'posted review')
    const [line] = lines()
    expect(line.service).toBe('webhook')
    expect(line.component).toBe('worker')
    expect(line.prNumber).toBe(42)
    expect(line.msg).toBe('posted review')
  })
})
