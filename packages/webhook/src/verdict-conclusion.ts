import type { ReviewResult } from './types.js'

/**
 * Map an agent-review result to a GitHub Checks `conclusion`.
 *
 * The conclusion answers one question: does a human need to act before merge?
 * The SP4 verdict encodes exactly that, so we drive the check off it:
 *   - `blocked` / `review-required` -> `action_required` (human must act)
 *   - `pass` / `comment`            -> `success`         (advisory at most)
 *
 * This also fixes a latent bug in the old risk_level-only mapping: a review
 * where every agent failed keeps `risk_level: 'low'` and so used to report
 * `success` ("safe to merge") even though nothing was actually reviewed. Such
 * a run now has `verdict: 'blocked'` and correctly reports `action_required`.
 *
 * Falls back to the legacy risk_level mapping when `verdict` is absent
 * (older agent responses, or non-review result paths that don't set it), so
 * behavior is unchanged for those.
 */
export function reviewConclusion(
  result: Pick<ReviewResult, 'verdict' | 'risk_level'>,
): 'success' | 'action_required' {
  if (result.verdict) {
    return result.verdict === 'blocked' || result.verdict === 'review-required'
      ? 'action_required'
      : 'success'
  }
  return result.risk_level === 'high' || result.risk_level === 'critical'
    ? 'action_required'
    : 'success'
}
