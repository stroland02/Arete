import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAgentMetricsPublisher, type AgentMetricsEvent } from './agent-metrics.js'

const EVENT: AgentMetricsEvent = {
  ts: '2026-07-20T12:00:00.000Z',
  event: 'review.completed',
  provider: 'github',
  repo: 'acme/api',
  prNumber: 42,
  trigger: 'pull_request',
  durationMs: 61000,
  traceId: 'abc123abc123abc123abc123abc12345',
}

describe('agent_metrics publisher (SSE dark wire — sse-handler.ts contract)', () => {
  let publish: ReturnType<typeof vi.fn>

  beforeEach(() => {
    publish = vi.fn().mockResolvedValue(1)
  })

  it('publishes single-line JSON to the agent_metrics channel', () => {
    const publisher = createAgentMetricsPublisher({ publish } as never)
    publisher(EVENT)
    expect(publish).toHaveBeenCalledTimes(1)
    const [channel, message] = publish.mock.calls[0]
    expect(channel).toBe('agent_metrics')
    expect(message).not.toContain('\n') // SSE data: framing requirement
    expect(JSON.parse(message)).toEqual(EVENT)
  })

  it('never throws when redis publish rejects (fire-and-forget)', async () => {
    publish.mockRejectedValue(new Error('redis down'))
    const publisher = createAgentMetricsPublisher({ publish } as never)
    expect(() => publisher(EVENT)).not.toThrow()
    await new Promise((r) => setImmediate(r)) // rejection settles without unhandled-rejection crash
  })
})
