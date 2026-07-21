import { trace, metrics, SpanStatusCode, type Counter, type Histogram } from '@opentelemetry/api'
import { publishAgentMetricsEvent } from './agent-metrics.js'

/**
 * Worker-side observability helpers — the §5 span tree (review.run root,
 * review.context.build / review.publish children; agent.review + llm.generate
 * live in the Python agents service) and the §5 arete.* metrics.
 *
 * Cardinality rule (§5, hard): metric dimensions are closed sets only —
 * outcome, trigger, queue. Repo names / PR numbers / installation ids go on
 * SPAN attributes, never metric dimensions.
 */

const tracer = trace.getTracer('arete-worker')

export interface ReviewSpanAttrs {
  provider: 'github' | 'gitlab'
  trigger: 'pull_request' | 'check_run' | 'merge_request'
  repoFullName: string
  prNumber: number
}

interface AreteMetrics {
  reviewRuns: Counter
  reviewDuration: Histogram
  queueJobs: Counter
}

let cached: AreteMetrics | null = null
function areteMetrics(): AreteMetrics {
  if (!cached) {
    const meter = metrics.getMeter('arete-worker')
    cached = {
      reviewRuns: meter.createCounter('arete.review.runs', {
        description: 'PR review runs by outcome and trigger',
      }),
      reviewDuration: meter.createHistogram('arete.review.duration', {
        unit: 's',
        description: 'End-to-end PR review duration (view: explicit buckets to 300s)',
      }),
      queueJobs: meter.createCounter('arete.queue.jobs', {
        description: 'BullMQ jobs by queue and outcome',
      }),
    }
  }
  return cached
}

export async function runWithReviewSpan(attrs: ReviewSpanAttrs, fn: () => Promise<void>): Promise<void> {
  const started = Date.now()
  return tracer.startActiveSpan(
    'review.run',
    {
      attributes: {
        'arete.provider': attrs.provider,
        'arete.trigger': attrs.trigger,
        'arete.repo.full_name': attrs.repoFullName,
        'arete.pr.number': attrs.prNumber,
      },
    },
    async (span) => {
      let outcome: 'success' | 'failure' = 'success'
      const base = {
        provider: attrs.provider,
        repo: attrs.repoFullName,
        prNumber: attrs.prNumber,
        trigger: attrs.trigger,
        traceId: span.spanContext().traceId,
      }
      publishAgentMetricsEvent({ ts: new Date().toISOString(), event: 'review.started', ...base })
      try {
        await fn()
        span.setStatus({ code: SpanStatusCode.OK })
        publishAgentMetricsEvent({
          ts: new Date().toISOString(),
          event: 'review.completed',
          durationMs: Date.now() - started,
          ...base,
        })
      } catch (err) {
        outcome = 'failure'
        span.recordException(err instanceof Error ? err : new Error(String(err)))
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
        publishAgentMetricsEvent({
          ts: new Date().toISOString(),
          event: 'review.failed',
          durationMs: Date.now() - started,
          ...base,
        })
        throw err
      } finally {
        const m = areteMetrics()
        m.reviewRuns.add(1, { outcome, trigger: attrs.trigger })
        m.reviewDuration.record((Date.now() - started) / 1000, { outcome, trigger: attrs.trigger })
        span.end()
      }
    }
  )
}

export async function withChildSpan<T>(
  name: 'review.context.build' | 'review.publish',
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn()
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw err
    } finally {
      span.end()
    }
  })
}

export function recordQueueJob(queue: string, outcome: 'completed' | 'failed'): void {
  areteMetrics().queueJobs.add(1, { queue, outcome })
}
