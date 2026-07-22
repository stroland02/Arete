import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { trace, INVALID_SPAN_CONTEXT, type Span } from '@opentelemetry/api'
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
  AlwaysOffSampler,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-node'
import { recordExceptionWithFingerprint, ISSUE_FINGERPRINT_ATTR } from './record-exception.js'
import { fingerprintError } from './fingerprint.js'
import { ScrubbingSpanProcessor } from './scrub-processor.js'
import { setServiceName, resetServiceName } from './service-name.js'

// See fingerprint.test.ts for why this literal is re-declared rather than
// shared: it is the cross-surface agreement gate for contract §5, asserted
// independently here (emit time), there (the shared normalizer), and in
// packages/dashboard/src/lib/error-fingerprint.test.ts (read time).
const GOLDEN_SERVICE = 'arete-worker'
const GOLDEN_MESSAGE =
  'checkout 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed at 2026-07-21T21:01:31Z after 3 tries'
const GOLDEN_FINGERPRINT = '59cd230950082264'

function exceptionEvent(span: ReadableSpan) {
  return span.events.find((e) => e.name === 'exception')
}

describe('recordExceptionWithFingerprint', () => {
  let exporter: InMemorySpanExporter
  let provider: NodeTracerProvider

  beforeEach(() => {
    resetServiceName()
    exporter = new InMemorySpanExporter()
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
  })

  afterEach(async () => {
    await provider.shutdown()
    resetServiceName()
  })

  function record(err: unknown, options?: { service?: string }): ReadableSpan {
    const span = provider.getTracer('test').startSpan('unit')
    recordExceptionWithFingerprint(span, err as Error, options)
    span.end()
    const [exported] = exporter.getFinishedSpans()
    return exported
  }

  it('records the exception event the SDK would record, plus the fingerprint', () => {
    const err = new TypeError('connection reset by peer')
    const exported = record(err, { service: 'arete-worker' })

    const event = exceptionEvent(exported)
    expect(event).toBeDefined()
    expect(event?.attributes?.['exception.type']).toBe('TypeError')
    expect(event?.attributes?.['exception.message']).toBe('connection reset by peer')
    expect(event?.attributes?.['exception.stacktrace']).toBe(err.stack)
    expect(event?.attributes?.[ISSUE_FINGERPRINT_ATTR]).toMatch(/^[0-9a-f]{16}$/)
  })

  it('emits exactly ONE exception event (it does not double-record)', () => {
    const exported = record(new Error('boom'), { service: 'arete-worker' })
    expect(exported.events.filter((e) => e.name === 'exception')).toHaveLength(1)
  })

  it('stamps the value the shared normalizer produces for the same (service, message)', () => {
    const exported = record(new Error(GOLDEN_MESSAGE), { service: GOLDEN_SERVICE })
    expect(exceptionEvent(exported)?.attributes?.[ISSUE_FINGERPRINT_ATTR]).toBe(
      fingerprintError(GOLDEN_SERVICE, GOLDEN_MESSAGE)
    )
  })

  it('stamps the frozen cross-surface golden value (contract §5 gate)', () => {
    const exported = record(new Error(GOLDEN_MESSAGE), { service: GOLDEN_SERVICE })
    expect(exceptionEvent(exported)?.attributes?.[ISSUE_FINGERPRINT_ATTR]).toBe(GOLDEN_FINGERPRINT)
  })

  it('groups two occurrences of the same failure that differ only in dynamic parts', () => {
    const a = record(new Error('checkout 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed after 3 tries'), {
      service: 'arete-worker',
    })
    const fpA = exceptionEvent(a)?.attributes?.[ISSUE_FINGERPRINT_ATTR]
    exporter.reset()
    const b = record(new Error('checkout 550e8400-e29b-41d4-a716-446655440000 failed after 91 tries'), {
      service: 'arete-worker',
    })
    expect(exceptionEvent(b)?.attributes?.[ISSUE_FINGERPRINT_ATTR]).toBe(fpA)
  })

  it('scopes the fingerprint by this process own service.name when none is passed', () => {
    setServiceName('arete-webhook')
    const exported = record(new Error('boom'))
    expect(exceptionEvent(exported)?.attributes?.[ISSUE_FINGERPRINT_ATTR]).toBe(
      fingerprintError('arete-webhook', 'boom')
    )
    // …and that is genuinely a different bucket from the worker's.
    expect(exceptionEvent(exported)?.attributes?.[ISSUE_FINGERPRINT_ATTR]).not.toBe(
      fingerprintError('arete-worker', 'boom')
    )
  })

  it('hashes the SCRUBBED message, so the key agrees with what reaches ClickHouse', () => {
    // ScrubbingSpanProcessor rewrites the exported exception.message; a
    // fingerprint taken over the raw text would disagree with the read-time
    // path for exactly the messages that contained a secret.
    const raw = '401 from provider: key sk-canary-a1b2c3d4e5f6g7h8 rejected'
    const scrubbed = '401 from provider: key [REDACTED] rejected'

    const scrubbingExporter = new InMemorySpanExporter()
    const scrubbingProvider = new NodeTracerProvider({
      spanProcessors: [new ScrubbingSpanProcessor(), new SimpleSpanProcessor(scrubbingExporter)],
    })
    const span = scrubbingProvider.getTracer('test').startSpan('unit')
    recordExceptionWithFingerprint(span, new Error(raw), { service: 'arete-worker' })
    span.end()

    const event = exceptionEvent(scrubbingExporter.getFinishedSpans()[0])
    expect(event?.attributes?.['exception.message']).toBe(scrubbed)
    expect(event?.attributes?.[ISSUE_FINGERPRINT_ATTR]).toBe(fingerprintError('arete-worker', scrubbed))
    // The fingerprint itself is 16 bare hex chars and survives the scrubber.
    expect(event?.attributes?.[ISSUE_FINGERPRINT_ATTR]).toMatch(/^[0-9a-f]{16}$/)
    return scrubbingProvider.shutdown()
  })

  it('prefers `code` over `name` for exception.type, as the SDK does', () => {
    const err = Object.assign(new Error('nope'), { code: 'ECONNRESET' })
    const exported = record(err, { service: 'arete-worker' })
    expect(exceptionEvent(exported)?.attributes?.['exception.type']).toBe('ECONNRESET')
  })

  it('accepts a bare string exception, as the SDK does', () => {
    const exported = record('something went wrong', { service: 'arete-worker' })
    const event = exceptionEvent(exported)
    expect(event?.attributes?.['exception.message']).toBe('something went wrong')
    expect(event?.attributes?.['exception.type']).toBeUndefined()
    expect(event?.attributes?.[ISSUE_FINGERPRINT_ATTR]).toBe(
      fingerprintError('arete-worker', 'something went wrong')
    )
  })

  it('records nothing when neither type nor message is present — same as the SDK', () => {
    const exported = record({}, { service: 'arete-worker' })
    expect(exceptionEvent(exported)).toBeUndefined()
  })

  it('never throws, whatever it is handed', () => {
    const span = provider.getTracer('test').startSpan('unit')
    expect(() => recordExceptionWithFingerprint(span, undefined as unknown as Error)).not.toThrow()
    expect(() => recordExceptionWithFingerprint(span, null as unknown as Error)).not.toThrow()
    span.end()
  })
})

describe('recordExceptionWithFingerprint on a non-recording span', () => {
  it('is a no-op on an unsampled span — no event is exported', async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new NodeTracerProvider({
      sampler: new AlwaysOffSampler(),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    const span = provider.getTracer('test').startSpan('unit')
    expect(span.isRecording()).toBe(false)
    recordExceptionWithFingerprint(span, new Error('boom'), { service: 'arete-worker' })
    span.end()
    expect(exporter.getFinishedSpans()).toHaveLength(0)
    await provider.shutdown()
  })

  it('is a no-op on an API NonRecordingSpan (no SDK registered)', () => {
    const span: Span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT)
    expect(span.isRecording()).toBe(false)
    expect(() => recordExceptionWithFingerprint(span, new Error('boom'))).not.toThrow()
  })
})
