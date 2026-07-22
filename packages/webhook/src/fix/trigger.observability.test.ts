import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { trace, context } from '@opentelemetry/api'
import { NodeTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-node'
import type { FixTriggerDeps, FixResponseBody } from './trigger.js'

// Same pattern as observability.test.ts's `runWithReviewSpan` suite (see the
// deviation notes there for why): a private NodeTracerProvider + in-memory
// exporter, `.register()` for the AsyncLocalStorageContextManager needed for
// parent/child linkage across `await` boundaries, and a DYNAMIC import of the
// module under test taken AFTER registration — a static top-level import
// would bind `trace.getTracer('arete-worker')` to the pre-registration
// @opentelemetry/api global state and silently stay a no-op tracer.
//
// This exercises the REAL driveFix (not a hand-rolled span helper in
// isolation) so the assertions prove the actual business logic emits the
// expected span tree — the gap this task closes: driveFix/processFixJob had
// zero explicit span instrumentation, so a fix drive showed the BullMQ
// producer/consumer spans and the Python fix.run tree, but nothing for the
// webhook-side stages in between.
describe('driveFix span tree (webhook-side fix.run root)', () => {
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

  function baseDeps(overrides: Partial<FixTriggerDeps> = {}): FixTriggerDeps {
    return {
      prisma: {
        workItem: {
          findUnique: async () => ({
            id: 'wi-1',
            installationId: 'inst-uuid',
            containerId: 'cont-1',
            kind: 'issue',
            title: 'SQL from raw input',
            detail: 'reports() passes q into db.raw',
            dimension: 'security',
            confidence: 0.8,
            evidence: [{ path: 'app/api/reports.ts', line: 3 }],
            fixFailureCount: 0,
          }),
          update: async () => ({}),
        },
        installation: { findUnique: async () => ({ id: 'inst-uuid', externalId: 4242 }) },
        repository: { findFirst: async () => ({ id: 'repo-1', fullName: 'acme/api' }) },
        issueContainer: {
          findUnique: async () => ({ id: 'cont-1', state: 'detecting' }),
          update: async () => ({}),
        },
      },
      resolveModel: async () => ({ provider: 'ollama', model: 'qwen2.5-coder', baseUrl: 'http://127.0.0.1:11434' }),
      mintToken: async () => 'ghs_token',
      fetchFix: async () => ({ status: 'fixed', patch: [{ path: 'app/api/reports.ts', content: 'safe();' }] }),
      ...overrides,
    }
  }

  it('wraps a fixed drive in a fix.run root span, parenting resolve/mint/agents-call/settle children', async () => {
    const { driveFix } = await import('./trigger.js')
    const deps = baseDeps()

    const result = await driveFix('wi-1', deps)
    expect(result).toEqual({ ok: true, status: 'fixed' })

    const spans = exporter.getFinishedSpans()
    const names = spans.map((s) => s.name).sort()
    expect(names).toEqual([
      'fix.agents.call',
      'fix.container.advance',
      'fix.container.settle',
      'fix.resolve',
      'fix.run',
      'fix.token.mint',
    ])

    const root = spans.find((s) => s.name === 'fix.run')!
    expect(root.attributes['arete.work_item.id']).toBe('wi-1')
    expect(root.attributes['arete.container.id']).toBe('cont-1')
    expect(root.attributes['arete.repo.full_name']).toBe('acme/api')
    expect(root.attributes['arete.installation.id']).toBe(4242)
    expect(root.attributes['arete.fix.dimension']).toBe('security')
    expect(root.attributes['arete.fix.outcome']).toBe('fixed')
    expect(root.status.code).toBe(1) // SpanStatusCode.OK

    // Every child must be directly parented under fix.run — this is the
    // trace-continuity assertion: driveFix's own stages must nest under ONE
    // root, which is itself the parent BullMQ's "process fix-drive" span
    // wraps, and which must in turn parent the Python fix.run span reached
    // over the (auto-instrumented) HTTP call inside fix.agents.call.
    for (const child of spans.filter((s) => s.name !== 'fix.run')) {
      expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    }
  })

  it('marks fix.run errored (without throwing) when the drive lands in fix_failed', async () => {
    const { driveFix } = await import('./trigger.js')
    const failResp: FixResponseBody = { status: 'fix_failed', reason: 'could not author a safe fix', patch: [] }
    const deps = baseDeps({ fetchFix: async () => failResp })

    const result = await driveFix('wi-1', deps)
    expect(result).toEqual({ ok: true, status: 'fix_failed' })

    const root = exporter.getFinishedSpans().find((s) => s.name === 'fix.run')!
    expect(root.attributes['arete.fix.outcome']).toBe('fix_failed')
    expect(root.status.code).toBe(2) // SpanStatusCode.ERROR
  })

  it('still opens (and errors) a fix.run span for a not_found work item, with no downstream children', async () => {
    const { driveFix } = await import('./trigger.js')
    const deps = baseDeps({
      prisma: { ...baseDeps().prisma, workItem: { findUnique: async () => null, update: async () => ({}) } },
    })

    const result = await driveFix('missing', deps)
    expect(result).toEqual({ ok: false, reason: 'not_found' })

    const spans = exporter.getFinishedSpans()
    expect(spans.map((s) => s.name)).toEqual(['fix.run'])
    expect(spans[0].attributes['arete.work_item.id']).toBe('missing')
    expect(spans[0].attributes['arete.fix.outcome']).toBe('error')
    expect(spans[0].status.code).toBe(2) // SpanStatusCode.ERROR
  })
})
