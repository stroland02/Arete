import { fingerprintScoped } from '@arete/telemetry/fingerprint'

/**
 * Normalizes dynamic variables (UUIDs, IPs, timestamps, numbers, strings) out
 * of a review comment body and produces a 16-character SHA-256 fingerprint.
 *
 * Based on the Superlog fingerprinting architecture, this allows Areté to group
 * repetitive LLM review comments (e.g. the same missing auth check across 15
 * different files) into a single unified incident bucket, reducing PR fatigue.
 *
 * DELEGATES to the one normalizer (`@arete/telemetry/fingerprint`, contract §5
 * "One fingerprint, one normalizer"). The rules used to be spelled out here and
 * mirrored a second time in the dashboard's `lib/error-fingerprint.ts` under a
 * "KEEP THE TWO RULE LISTS IN SYNC" comment. They are one list now.
 *
 * WHY THIS FUNCTION STILL EXISTS RATHER THAN BEING DELETED IN FAVOUR OF
 * `fingerprintError`. The hash is genuinely identical — same normalization,
 * same `${scope}::${normalized}` canonical form, same sha256/16-char slice —
 * so unifying the ALGORITHM was correct and is done. But the two callers scope
 * by different things: an error is grouped within its emitting **service**, a
 * review comment within its **category**. Collapsing them into one exported
 * name would mean review-comment code calling something named
 * `fingerprintError(category, body)`, where the argument names lie about what
 * is being passed. So the shared primitive is `fingerprintScoped(scope, text)`
 * and each domain keeps its honest wrapper. Note that comment fingerprints and
 * error fingerprints share a value space by construction: a category that
 * happened to equal a service name, over identical text, yields the same
 * 16 chars. That is harmless — they are stored in different columns of
 * different tables and never compared — but it is a fact, not an accident, and
 * is recorded here so nobody "discovers" it later as a bug.
 */
export function fingerprintComment(body: string, category: string): string {
  return fingerprintScoped(category, body)
}
