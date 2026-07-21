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
