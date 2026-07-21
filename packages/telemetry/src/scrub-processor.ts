import type { Context } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-node'
import { REDACT_KEYS, REDACTED, scrubText, stripUrlQuery } from './redaction.js'

const URL_ATTRIBUTES = new Set(['http.url', 'url.full', 'http.target', 'url.path'])
const BLOCKED_KEY_SET = new Set<string>(REDACT_KEYS)

function isBlockedKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (BLOCKED_KEY_SET.has(lower)) return true
  // Matches http.request.header.authorization, arete.config.api_key, etc.
  return [...BLOCKED_KEY_SET].some((k) => lower.endsWith(`.${k}`) || lower.endsWith(`_${k}`))
}

/**
 * In-process span scrubber (spec §5 redaction, §6 gate 2). Registered BEFORE
 * the exporting BatchSpanProcessor, so its onEnd mutation is visible to the
 * exporter. Defense-in-depth with the collector's redaction processor
 * (Agent B) — this one guarantees secrets never even leave the process.
 */
export class ScrubbingSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(span: ReadableSpan): void {
    const attrs = span.attributes as Record<string, unknown>
    for (const key of Object.keys(attrs)) {
      const value = attrs[key]
      if (isBlockedKey(key)) {
        attrs[key] = REDACTED
        continue
      }
      if (typeof value !== 'string') continue
      if (URL_ATTRIBUTES.has(key)) {
        attrs[key] = stripUrlQuery(value)
        continue
      }
      attrs[key] = scrubText(value)
    }

    for (const event of span.events) {
      const eventAttrs = event.attributes as Record<string, unknown> | undefined
      if (!eventAttrs) continue
      for (const key of Object.keys(eventAttrs)) {
        const value = eventAttrs[key]
        if (typeof value === 'string') eventAttrs[key] = scrubText(value)
      }
    }

    if (span.status.message) {
      ;(span.status as { message?: string }).message = scrubText(span.status.message)
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}
