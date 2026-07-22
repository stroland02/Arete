// The ONE error/issue grouping normalizer for the whole TypeScript side.
//
// Governing law: docs/superpowers/specs/2026-07-22-telemetry-tenancy-contract.md
// §5 — "One fingerprint, one normalizer". Grouping "the same error seen many
// times" must not depend on which surface you look at, and it must not depend
// on WHEN the key is computed: the dashboard computes it at READ time
// (lib/errors.ts, over rows already in ClickHouse) while the emitters stamp it
// at EMIT time as `superlog.issue_fingerprint` (record-exception.ts, consumed
// by the superlog.otel_exceptions / superlog.issue_activity_daily projections).
// Two implementations would split one error into two groups and quietly break
// "resolve these together", so there is exactly one, and it lives here.
//
// WHY HERE, and not in the dashboard where it started: the thing that must
// stamp is the EMITTER, and @arete/telemetry is the package every TypeScript
// emitter already depends on (@arete/webhook, for both the webhook and the
// worker process). This module deliberately imports NOTHING but `node:crypto`
// and is published under its own `@arete/telemetry/fingerprint` subpath export,
// so a consumer that only wants the hash — the Next.js dashboard — never pulls
// the OpenTelemetry Node SDK bootstrap (`init.ts`) into its bundle. That
// bundling concern is the exact reason the old dashboard module was a
// hand-maintained COPY of packages/webhook/src/fingerprint.ts; the subpath
// export removes the reason, so the copy is gone.
//
// This follows the precedent set by the platform-installation resolver moving
// into @arete/db (contract §2, "one resolver, one truth"): a rule two packages
// must both obey lives in the package they both depend on, not in two files
// with a "KEEP THESE IN SYNC" comment.

import { createHash } from 'node:crypto'

/**
 * Strips the dynamic parts out of an error message so two occurrences of the
 * SAME failure — differing only in a request uuid, a retry count, a URL, or a
 * timestamp — normalize to one identical string.
 *
 * Rule order matters: URLs and emails are consumed before the narrower
 * uuid/ip/number rules can chew holes in them, and quoted strings are replaced
 * before the bare-number rule so a quoted numeric literal collapses once.
 *
 * Returns '' for empty/whitespace-only input — callers decide what that means
 * (see dashboard lib/errors.ts: a group with no message keeps the span name as
 * its title).
 */
export function normalizeErrorMessage(raw: string): string {
  let s = raw
  s = s.replace(/https?:\/\/\S+/gi, '<url>')
  s = s.replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, '<email>')
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
  s = s.replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?(?:[+-]\d{2}:?\d{2})?\b/g, '<ts>')
  s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<ip>')
  s = s.replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '<str>')
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, '<str>')
  s = s.replace(/\b\d+\b/g, '<n>')
  s = s.replace(/\s+/g, ' ').trim().toLowerCase()
  return s
}

/**
 * The grouping primitive: 16 hex chars of
 * `sha256(`${scope}::${normalizeErrorMessage(text)}`)`.
 *
 * `scope` is the partition the text is grouped WITHIN — it is part of the
 * canonical string so the same generic text under two different scopes stays
 * two groups. The two domain wrappers below name that scope for their domain
 * (`service` for errors, `category` for review comments); they are the SAME
 * hash, not two similar ones, which is why they share this function rather
 * than each owning a copy of the sha256/slice line.
 *
 * 16 chars = 64 bits, matching the `fingerprint` column on ErrorGroup
 * (`@@unique([installationId, fingerprint])`) and the `fingerprint` column of
 * superlog.otel_exceptions.
 */
export function fingerprintScoped(scope: string, text: string): string {
  const canonical = `${scope}::${normalizeErrorMessage(text)}`
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/**
 * The grouping key for one observed error.
 *
 * The service is the scope so the same generic message ("connection reset")
 * emitted by arete-worker and arete-agents stays two groups — they are two
 * different failures to go fix, and merging them would hide one behind the
 * other's volume. `service` must be the OTel resource `service.name`, because
 * that is the column (`ServiceName`) the read-time path groups on.
 */
export function fingerprintError(service: string, message: string): string {
  return fingerprintScoped(service, message)
}
