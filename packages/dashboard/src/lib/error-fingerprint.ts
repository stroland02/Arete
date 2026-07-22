// Deterministic grouping key for observed errors.
//
// MIRRORS packages/webhook/src/fingerprint.ts (`fingerprintComment`) — the SAME
// replacement rules, in the SAME order, producing the SAME 16-char sha256
// shape. That is deliberate: an operator who sees the webhook group 15 review
// comments into one bucket must see the Errors surface group 15 error events
// the same way, or "grouping" means two different things in one product.
//
// It is COPIED rather than imported because @arete/webhook and @arete/dashboard
// are separate workspace packages with no shared lib package between them, and
// the dashboard must not take a dependency on the webhook service (it is a
// deployable, not a library — importing it would pull its Prisma client,
// OpenTelemetry bootstrap and env expectations into the Next.js bundle).
// If a shared `@arete/core` ever lands, both should move there and this
// duplicate should be deleted. KEEP THE TWO RULE LISTS IN SYNC.

import { createHash } from 'node:crypto';

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
 * (see errors.ts: a group with no message keeps the span name as its title).
 */
export function normalizeErrorMessage(raw: string): string {
  let s = raw;
  s = s.replace(/https?:\/\/\S+/gi, '<url>');
  s = s.replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, '<email>');
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>');
  s = s.replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?(?:[+-]\d{2}:?\d{2})?\b/g, '<ts>');
  s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<ip>');
  s = s.replace(/\b0x[0-9a-f]+\b/gi, '<hex>');
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '<str>');
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, '<str>');
  s = s.replace(/\b\d+\b/g, '<n>');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return s;
}

/**
 * The grouping key for one error: 16 hex chars of
 * sha256(`${service}::${normalizeErrorMessage(message)}`).
 *
 * The service is part of the canonical string so the same generic message
 * ("connection reset") emitted by arete-worker and arete-agents stays two
 * groups — they are two different failures to go fix, and merging them would
 * hide one behind the other's volume.
 *
 * 16 chars = 64 bits, matching the webhook module and the `fingerprint` column
 * on ErrorGroup (`@@unique([installationId, fingerprint])`).
 */
export function fingerprintError(service: string, message: string): string {
  const canonical = `${service}::${normalizeErrorMessage(message)}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
