import type { Octokit } from '@octokit/core'
import type { TelemetrySnapshot } from '../types.js'

const RECENT_RUNS_TO_SAMPLE = 20

/**
 * Aggregate CI health over the most recent workflow runs for a repo. Uses
 * the installation's existing Octokit client — no new credential storage,
 * unlike the PostHog connector. Distinct from the existing CIAgent/
 * check_run flow, which diagnoses one specific failing run tied to a PR;
 * this is aggregate historical context fed to the BusinessLogicAgent.
 *
 * Never throws — any failure (rate limit, no workflows configured, etc.)
 * returns null so the caller can uniformly skip a connector that didn't
 * produce data, per the "never block the review" rule.
 */
export async function fetchGitHubActionsSnapshot(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<TelemetrySnapshot | null> {
  try {
    const { data } = await (octokit as any).rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      per_page: RECENT_RUNS_TO_SAMPLE,
    })
    const runs: Array<{ conclusion: string | null }> = data.workflow_runs ?? []
    if (runs.length === 0) return null

    const failures = runs.filter((r) => r.conclusion === 'failure').length
    const total = runs.length
    const successes = total - failures

    return {
      provider: 'github_actions',
      source_ref: `${owner}/${repo}`,
      summary_text: `${successes} of ${total} recent CI runs passed (${failures} failed).`,
      metrics: { failure_rate: failures / total },
      links: [],
      fetched_at: new Date().toISOString(),
    }
  } catch {
    return null
  }
}
