// The production caller around the tested stagePullRequest core — the send seam
// the dashboard's "Post PR" action invokes (POST /staging/send). See
// docs/superpowers/specs/2026-07-13-issue-container-and-pr-pipeline.md §4 step 8.
//
// The dashboard hands us two internal uuids: { containerId, installationId }.
// This orchestration resolves them into the arguments stagePullRequest needs —
// an installation-authed Octokit and the approved container slice — then runs
// the gate-enforced, idempotent core and flattens its result into a single
// outcome the dashboard action switches on.
//
// Every side-effecting dependency is INJECTED (resolveExternalId / getOctokit /
// loadContainer), so this is driven end-to-end in tests with fakes and the real
// stagePullRequest — no @arete/db, no GitHub App private key. server.ts wires the
// real implementations.

import { stagePullRequest, type ApprovedContainer, type StagingOctokit } from './stage-pr.js'

export interface StagingSendInput {
  /** Issue-container id (internal uuid). */
  containerId: string
  /** Installation id (internal uuid) — the tenant the caller is acting as. */
  installationId: string
}

export interface StagingSendDeps {
  /** internal installation uuid -> GitHub App numeric installation id
   *  (Installation.externalId). Returns null if no such installation. */
  resolveExternalId(installationId: string): Promise<number | null>
  /** numeric installation id -> an Octokit authed for that installation. */
  getOctokit(externalId: number): Promise<StagingOctokit>
  /** (containerId, installationId) -> the approved container slice, already
   *  scoped to the tenant. Returns null if none for this tenant. */
  loadContainer(containerId: string, installationId: string): Promise<ApprovedContainer | null>
}

/** Flat outcome the dashboard action switches on. `not_found` is no container for
 *  this tenant (404); `not_approved` is the gate refusing to send (409); `failed`
 *  is any resolution/upstream error (never thrown). */
export type StagingSendResult =
  | { outcome: 'opened'; prNumber: number; prUrl: string }
  | { outcome: 'already_open'; prNumber: number; prUrl: string }
  | { outcome: 'not_approved' }
  | { outcome: 'not_found' }
  | { outcome: 'failed'; detail: string }

export async function runStagingSend(
  deps: StagingSendDeps,
  input: StagingSendInput,
): Promise<StagingSendResult> {
  const { containerId, installationId } = input
  try {
    // 1. installation uuid -> numeric external id. A phantom tenant short-
    //    circuits here: we never load a container or touch GitHub.
    const externalId = await deps.resolveExternalId(installationId)
    if (externalId === null) {
      return { outcome: 'failed', detail: `unknown installation: ${installationId}` }
    }

    // 2. Load the approved container slice, scoped to the tenant.
    const container = await deps.loadContainer(containerId, installationId)
    if (container === null) {
      // No container for this tenant — a distinct signal from an upstream failure
      // (mapped to 404, not 502), and from a container that exists but isn't yet
      // approved (not_approved → 409).
      return { outcome: 'not_found' }
    }

    // 3. Defense in depth behind loadContainer's own scoping: never send a
    //    container that belongs to a different tenant than the caller claimed.
    if (container.installationId !== installationId) {
      return { outcome: 'failed', detail: 'tenant mismatch: container belongs to another installation' }
    }

    // 4. Resolve the installation Octokit and run the gate-enforced, idempotent
    //    core. It refuses to send unless gates.solutionApprovedAt is set.
    const octokit = await deps.getOctokit(externalId)
    const staged = await stagePullRequest(octokit, container)

    switch (staged.outcome) {
      case 'not_approved':
        return { outcome: 'not_approved' }
      case 'opened':
        return { outcome: 'opened', prNumber: staged.number, prUrl: staged.hostUrl }
      case 'already_open':
        return { outcome: 'already_open', prNumber: staged.number, prUrl: staged.hostUrl }
    }
  } catch (err) {
    // Never throw across the seam: an upstream/resolution error is a `failed`
    // outcome the dashboard can surface, not a 500 stack trace.
    return { outcome: 'failed', detail: err instanceof Error ? err.message : String(err) }
  }
}
