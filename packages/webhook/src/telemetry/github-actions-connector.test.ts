import { webhookFetch } from '@arete/net-guard'
vi.mock('@arete/net-guard', () => ({ webhookFetch: vi.fn() }))
const _webhookFetchMock = vi.mocked(webhookFetch)
import { describe, it, expect, vi, afterEach } from 'vitest'
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
  afterEach(() => {
    vi.useRealTimers()
  })

  it('summarizes recent workflow run health', async () => {
    const octokit = makeOctokit([
      { conclusion: 'success' }, { conclusion: 'success' }, { conclusion: 'failure' },
    ])
    const result = await fetchGitHubActionsSnapshot(octokit, 'acme', 'api')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const snap = result.snapshot
    expect(snap.provider).toBe('github_actions')
    expect(snap.source_ref).toBe('acme/api')
    expect(snap.summary_text).toContain('2')
    expect(snap.summary_text).toContain('3')
    expect(snap.metrics.failure_rate).toBeCloseTo(1 / 3)
  })

  it('returns no-data (not an error) when the repo has no workflow runs', async () => {
    const octokit = makeOctokit([])
    const result = await fetchGitHubActionsSnapshot(octokit, 'acme', 'api')
    expect(result).toEqual({ status: 'no-data' })
  })

  it('returns an error result (never throws) when the GitHub API call fails', async () => {
    const octokit = {
      rest: { actions: { listWorkflowRunsForRepo: vi.fn().mockRejectedValue(new Error('rate limited')) } },
    } as any
    const result = await fetchGitHubActionsSnapshot(octokit, 'acme', 'api')
    expect(result).toEqual({ status: 'error' })
  })

  it('aborts a hung GitHub API call after the fetch timeout instead of blocking the review', async () => {
    vi.useFakeTimers()
    // Simulates a hung request that only settles when the caller aborts it —
    // if the connector never passes an abort signal (the old behavior), this
    // promise never settles and the test times out instead of passing.
    const listWorkflowRunsForRepo = vi.fn().mockImplementation(
      (params: any) =>
        new Promise((_resolve, reject) => {
          params.request.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
    )
    const octokit = { rest: { actions: { listWorkflowRunsForRepo } } } as any

    const pending = fetchGitHubActionsSnapshot(octokit, 'acme', 'api')
    await vi.advanceTimersByTimeAsync(8_000)
    const result = await pending
    expect(result).toEqual({ status: 'error' })
  })
})

