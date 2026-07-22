import { trace, metrics, SpanStatusCode, type Counter, type Histogram, type Span } from '@opentelemetry/api'
import { publishAgentMetricsEvent } from './agent-metrics.js'

/**
 * Worker-side observability helpers — the §5 span tree (review.run root,
 * review.context.build / review.publish children; agent.review + llm.generate
 * live in the Python agents service) and the §5 arete.* metrics.
 *
 * `fix.run` (root, `driveFix` in fix/trigger.ts) follows the same worker-root
 * pattern as `review.run`: it wraps the webhook-side stages of a fix drive
 * (repo/installation/model resolution, token minting, the HTTP call into the
 * agents service, and the container state writes) and — via the
 * auto-instrumented `fetch` call inside `fix.agents.call` propagating W3C
 * trace headers — becomes the parent of the Python `fix.run` pipeline span
 * (Phase 2 Task 14, `arete_agents/fix_pipeline.py`), so one trace covers the
 * whole drive: BullMQ producer → consumer → this span tree → the Python
 * pipeline. Reusing the SAME span name on both sides ("fix.run") is
 * deliberate — it is the ONE business-op vocabulary term for "a fix drive",
 * per spec §5's frozen tree, appearing at the webhook layer and the pipeline
 * layer exactly the way `review.run` is the one worker-root term even though
 * Python nests its own review-path spans underneath it.
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
  name:
    | 'review.context.build'
    | 'review.publish'
    | 'fix.resolve'
    | 'fix.token.mint'
    | 'fix.container.advance'
    // Reading the incident's own trace/log/exception context before authoring
    // (fix/incident-signals.ts). Its own child so a slow telemetry read is
    // attributable instead of inflating fix.agents.call.
    | 'fix.signals.collect'
    | 'fix.agents.call'
    | 'fix.container.settle',
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

export interface FixSpanAttrs {
  workItemId: string
}

/**
 * Webhook-side `fix.run` root span (see the module doc comment above for why
 * it deliberately reuses the Python pipeline's span name rather than coining
 * a second vocabulary term). `driveFix` (fix/trigger.ts) never throws by its
 * own documented contract — every failure path resolves to a `FixDriveResult`
 * — so this wrapper's try/catch exists only as a defensive backstop (Global
 * Constraint: telemetry code itself must never be what turns a real drive
 * into an exception; if `fn` ever does throw unexpectedly this still records
 * it faithfully and rethrows unchanged rather than swallowing it).
 *
 * `fn` receives the span so the caller can enrich it with attributes only
 * known mid-drive (container id, repo full name, installation id, dimension
 * — all resolved from the WorkItem/Installation/Repository lookups) and set
 * a terminal `arete.fix.outcome` + span status before it ends.
 */
export async function runWithFixSpan<T>(attrs: FixSpanAttrs, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(
    'fix.run',
    { attributes: { 'arete.work_item.id': attrs.workItemId } },
    async (span) => {
      try {
        return await fn(span)
      } catch (err) {
        span.recordException(err instanceof Error ? err : new Error(String(err)))
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
        throw err
      } finally {
        span.end()
      }
    }
  )
}

export function recordQueueJob(queue: string, outcome: 'completed' | 'failed'): void {
  areteMetrics().queueJobs.add(1, { queue, outcome })
}

/**
 * Marks a fix-drive job dropped by the cooldown gate — the second of the two
 * cooldown enforcement points (queue-consumer.ts's `processFixJob`; the
 * dashboard route is the first, ahead of the enqueue). A dropped job never
 * calls `driveFix`, so it would otherwise be a silent gap under the BullMQ
 * consumer span: no `fix.run`, no record of why nothing happened. `workItemId`
 * is a span attribute only — never a metric dimension (§5 cardinality rule).
 */
export function recordFixCooldownDrop(workItemId: string, retryAfterSeconds: number): void {
  const span = tracer.startSpan('fix.cooldown.drop', {
    attributes: {
      'arete.work_item.id': workItemId,
      'arete.fix.cooldown.retry_after_seconds': retryAfterSeconds,
    },
  })
  span.end()
}
