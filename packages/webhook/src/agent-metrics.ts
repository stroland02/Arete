import { Redis as IORedis } from 'ioredis'

/**
 * Publisher side of the Redis SSE dark wire (spec §3 Phase 1): the worker
 * publishes review-lifecycle events to the `agent_metrics` PubSub channel
 * that sse-handler.ts already subscribes to and forwards verbatim as SSE
 * `data:` lines — so payloads MUST be single-line JSON.
 *
 * Cardinality note: this is an event stream, not a metric — repo/prNumber
 * are fine here (they'd be forbidden as metric dimensions per §5).
 */

export const AGENT_METRICS_CHANNEL = 'agent_metrics'

export interface AgentMetricsEvent {
  ts: string
  event: 'review.started' | 'review.completed' | 'review.failed'
  provider: 'github' | 'gitlab'
  repo: string
  prNumber: number
  trigger: 'pull_request' | 'check_run' | 'merge_request'
  durationMs?: number
  traceId?: string
}

type PublishClient = Pick<IORedis, 'publish'>

/** Factory (test seam). Fire-and-forget: SSE liveness must never fail a review. */
export function createAgentMetricsPublisher(client: PublishClient): (event: AgentMetricsEvent) => void {
  return (event: AgentMetricsEvent) => {
    try {
      void client.publish(AGENT_METRICS_CHANNEL, JSON.stringify(event)).catch(() => {})
    } catch {
      // never let a metrics publish break the pipeline
    }
  }
}

let defaultPublisher: ((event: AgentMetricsEvent) => void) | null = null

/** Lazy singleton over a dedicated Redis connection (subscribe-mode conns
 *  can't publish, so this must not share sse-handler's subscriber). */
export function publishAgentMetricsEvent(event: AgentMetricsEvent): void {
  if (process.env.NODE_ENV === 'test' && !defaultPublisher) {
    defaultPublisher = () => {}
  }
  if (!defaultPublisher) {
    try {
      const client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        lazyConnect: false,
      })
      defaultPublisher = createAgentMetricsPublisher(client)
    } catch {
      defaultPublisher = () => {}
    }
  }
  defaultPublisher(event)
}
