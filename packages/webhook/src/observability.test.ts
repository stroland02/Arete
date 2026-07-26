import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { trace, context } from '@opentelemetry/api'
import { NodeTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-node'

// NOTE (deviations from task-11-brief.md's literal test code, verified with
// installed @opentelemetry/api@1.9.1 + sdk-trace-node@2.9.0 under vitest 2):
//
// 1. `provider.register()` instead of `trace.setGlobalTracerProvider(provider)`.
//    setGlobalTracerProvider alone does not install a context manager —
//    @opentelemetry/api's default no-op context manager doesn't track the
//    active span across `await` boundaries, so withChildSpan's children never
//    see review.run as their parent. `.register()` additionally installs an
//    AsyncLocalStorageContextManager, which is what parent/child linkage
//    actually requires.
//
// 2. `runWithReviewSpan`/`withChildSpan` are imported dynamically (after
//    `provider.register()` runs in beforeEach) rather than via a static
//    top-level import. observability.ts calls `trace.getTracer('arete-worker')`
//    once at module scope; if that happens (as a static import forces) before
//    any provider is registered, the resulting ProxyTracer is bound to the
//    pre-registration @opentelemetry/api global state and never picks up the
//    later-registered delegate in this Vite/vitest module environment (traced
//    and reproduced in isolation — same @opentelemetry/api singleton, but the
//    ProxyTracer created pre-registration silently stays a no-op). Deferring
//    the import until after registration — the same `vi.resetModules()` +
//    dynamic `import()` pattern already used in queue.test.ts for a related
//    module-caching problem — sidesteps it entirely.
describe('runWithReviewSpan (§5 span tree root)', () => {
  let exporter: InMemorySpanExporter
  let provider: NodeTracerProvider

  beforeEach(() => {
    vi.resetModules()
    exporter = new InMemorySpanExporter()
    provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
    provider.register()
  })

  afterEach(async () => {
    await provider.shutdown()
    trace.disable()
    context.disable()
  })

  it('wraps the job in a review.run root span with §5 attributes and success status', async () => {
    const { runWithReviewSpan, withChildSpan } = await import('./observability.js')
    await runWithReviewSpan(
      { provider: 'github', trigger: 'pull_request', repoFullName: 'acme/api', prNumber: 42 },
      async () => {
        await withChildSpan('review.context.build', async () => {})
        await withChildSpan('review.publish', async () => {})
      }
    )
    const spans = exporter.getFinishedSpans()
    const names = spans.map((s) => s.name).sort()
    expect(names).toEqual(['review.context.build', 'review.publish', 'review.run'])
    const root = spans.find((s) => s.name === 'review.run')!
    expect(root.attributes['arete.provider']).toBe('github')
    expect(root.attributes['arete.trigger']).toBe('pull_request')
    expect(root.attributes['arete.repo.full_name']).toBe('acme/api')
    expect(root.attributes['arete.pr.number']).toBe(42)
    // children parented under review.run
    for (const child of spans.filter((s) => s.name !== 'review.run')) {
      expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    }
  })

  it('marks the span errored and re-throws on failure', async () => {
    const { runWithReviewSpan } = await import('./observability.js')
    await expect(
      runWithReviewSpan(
        { provider: 'gitlab', trigger: 'merge_request', repoFullName: 'acme/gitlab-api', prNumber: 5 },
        async () => {
          throw new Error('pipeline exploded')
        }
      )
    ).rejects.toThrow('pipeline exploded')
    const root = exporter.getFinishedSpans().find((s) => s.name === 'review.run')!
    expect(root.status.code).toBe(2) // SpanStatusCode.ERROR
    expect(root.events.some((e) => e.name === 'exception')).toBe(true)
  })
})
