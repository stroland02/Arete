import type { Octokit } from '@octokit/core'
import type { ConnectorResult } from './connector-result.js'

const RECENT_RUNS_TO_SAMPLE = 20
// Same bound as the PostHog connector: this fetch runs before the review's
// check run is created, so a hung GitHub API request must never be able to
// stall the review pipeline.
const FETCH_TIMEOUT_MS = 8_000

/**
 * Aggregate CI health over the most recent workflow runs for a repo. Uses
 * the installation's existing Octokit client — no new credential storage,
 * unlike the PostHog connector. Distinct from the existing CIAgent/
 * check_run flow, which diagnoses one specific failing run tied to a PR;
 * this is aggregate historical context fed to the BusinessLogicAgent.
 *
 * Never throws — a repo with no workflow runs resolves to 'no-data', and
 * any real failure (rate limit, timeout, network error) resolves to
 * 'error', per the "never block the review" rule. The distinction matters:
 * only 'error' counts against the provider circuit breaker.
 */
export async function fetchGitHubActionsSnapshot(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<ConnectorResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const { data } = await (octokit as any).rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      per_page: RECENT_RUNS_TO_SAMPLE,
      // @octokit/core v6 request layer is fetch-based; `request.signal` is
      // the supported per-call cancellation mechanism.
      request: { signal: controller.signal },
    })
    const runs: Array<{ conclusion: string | null }> = data.workflow_runs ?? []
    if (runs.length === 0) return { status: 'no-data' }

    const failures = runs.filter((r) => r.conclusion === 'failure').length
    const total = runs.length
    const successes = total - failures

    return {
      status: 'ok',
      snapshot: {
        provider: 'github_actions',
        source_ref: `${owner}/${repo}`,
        summary_text: `${successes} of ${total} recent CI runs passed (${failures} failed).`,
        metrics: { failure_rate: failures / total },
        links: [],
        fetched_at: new Date().toISOString(),
      },
    }
  } catch {
    return { status: 'error' }
  } finally {
    clearTimeout(timer)
  }
}
