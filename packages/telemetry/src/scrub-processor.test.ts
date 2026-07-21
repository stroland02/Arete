import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NodeTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-node'
import { ScrubbingSpanProcessor } from './scrub-processor.js'

// Fake canary secret — the §6 gate: injected into a span attribute, a URL
// query string, and a thrown exception; must NEVER reach the exporter.
const CANARY = 'sk-canary-a1b2c3d4e5f6g7h8'

describe('ScrubbingSpanProcessor (canary scrub test — spec §6 gate 2)', () => {
  let exporter: InMemorySpanExporter
  let provider: NodeTracerProvider

  beforeEach(() => {
    exporter = new InMemorySpanExporter()
    provider = new NodeTracerProvider({
      spanProcessors: [
        new ScrubbingSpanProcessor(),          // runs first: mutates on end
        new SimpleSpanProcessor(exporter),     // then exports the scrubbed span
      ],
    })
  })

  afterEach(async () => {
    await provider.shutdown()
  })

  it('a secret in a span attribute, a URL query, and a thrown error never reaches the exporter', () => {
    const tracer = provider.getTracer('canary')
    const span = tracer.startSpan('llm.generate')
    span.setAttribute('http.url', `https://generativelanguage.googleapis.com/v1/models?key=${CANARY}`)
    span.setAttribute('url.full', `https://api.example.com/v1/chat?api_key=${CANARY}`)
    span.setAttribute('arete.debug.note', `failed with Bearer ${CANARY}`)
    span.setAttribute('authorization', `Bearer ${CANARY}`)
    span.recordException(new Error(`401 from provider: key ${CANARY} rejected`))
    span.setStatus({ code: 2, message: `request with ${CANARY} failed` })
    span.end()

    const exported = exporter.getFinishedSpans()
    expect(exported).toHaveLength(1)
    // The SDK's own ReadableSpan holds a back-reference to its SpanProcessor
    // (which holds the exporter, which holds this same finished-spans array),
    // so a plain replacer isn't enough — break cycles while still walking
    // every real field (attributes/events/status) for the canary.
    const seen = new WeakSet<object>()
    const serialized = JSON.stringify(exported, (_k, v) => {
      if (typeof v === 'bigint') return v.toString()
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return undefined
        seen.add(v)
      }
      return v
    })
    expect(serialized).not.toContain(CANARY)

    const attrs = exported[0].attributes
    // Query strings stripped entirely on url attributes (spec §5)
    expect(attrs['http.url']).toBe('https://generativelanguage.googleapis.com/v1/models')
    expect(attrs['url.full']).toBe('https://api.example.com/v1/chat')
    // Blocklisted key fully redacted
    expect(attrs['authorization']).toBe('[REDACTED]')
    // Free-text attribute pattern-scrubbed, message retained
    expect(attrs['arete.debug.note']).toContain('[REDACTED]')
  })

  it('scrubs secret-shaped substrings inside string-array attribute values, leaving non-string elements untouched', () => {
    const tracer = provider.getTracer('canary')
    const span = tracer.startSpan('llm.generate')
    span.setAttribute('arete.debug.notes', [`failed with Bearer ${CANARY}`, 'clean value'])
    span.end()

    const exported = exporter.getFinishedSpans()
    expect(exported).toHaveLength(1)
    const seen = new WeakSet<object>()
    const serialized = JSON.stringify(exported, (_k, v) => {
      if (typeof v === 'bigint') return v.toString()
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return undefined
        seen.add(v)
      }
      return v
    })
    expect(serialized).not.toContain(CANARY)

    const attrs = exported[0].attributes
    expect(attrs['arete.debug.notes']).toEqual(['failed with [REDACTED]', 'clean value'])
  })

  it('leaves clean spans untouched', () => {
    const tracer = provider.getTracer('canary')
    const span = tracer.startSpan('review.run')
    span.setAttribute('arete.repo.full_name', 'acme/api')
    span.setAttribute('arete.pr.number', 42)
    span.end()
    const [exported] = exporter.getFinishedSpans()
    expect(exported.attributes['arete.repo.full_name']).toBe('acme/api')
    expect(exported.attributes['arete.pr.number']).toBe(42)
  })
})
