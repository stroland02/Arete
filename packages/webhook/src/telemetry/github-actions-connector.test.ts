import { describe, it, expect, vi } from 'vitest'
import { fetchGitHubActionsSnapshot } from './github-actions-connector.js'

function makeOctokit(runs: Array<{ conclusion: string | null }>) {
  return {
    rest: {
      actions: {
        listWorkflowRunsForRepo: vi.fn().mockResolvedValue({
          data: { workflow_runs: runs },
        }),
      },
    },
  } as any
}

describe('fetchGitHubActionsSnapshot', () => {
  it('summarizes recent workflow run health', async () => {
    const octokit = makeOctokit([
      { conclusion: 'success' }, { conclusion: 'success' }, { conclusion: 'failure' },
    ])
    const snap = await fetchGitHubActionsSnapshot(octokit, 'acme', 'api')
    expect(snap).not.toBeNull()
    expect(snap!.provider).toBe('github_actions')
    expect(snap!.source_ref).toBe('acme/api')
    expect(snap!.summary_text).toContain('2')
    expect(snap!.summary_text).toContain('3')
    expect(snap!.metrics.failure_rate).toBeCloseTo(1 / 3)
  })

  it('returns null when there are no workflow runs', async () => {
    const octokit = makeOctokit([])
    const snap = await fetchGitHubActionsSnapshot(octokit, 'acme', 'api')
    expect(snap).toBeNull()
  })

  it('returns null (never throws) when the GitHub API call fails', async () => {
    const octokit = {
      rest: { actions: { listWorkflowRunsForRepo: vi.fn().mockRejectedValue(new Error('rate limited')) } },
    } as any
    const snap = await fetchGitHubActionsSnapshot(octokit, 'acme', 'api')
    expect(snap).toBeNull()
  })
})
