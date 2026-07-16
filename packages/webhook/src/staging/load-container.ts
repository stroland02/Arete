// Integration seam: resolve an approved IssueContainer *slice* by id, scoped to
// its tenant, for POST /staging/send.
//
// Per the Task-3 substrate decision (Option A: injected slice + GitHub as the
// source of truth, NO schema on the webhook/@arete/db lane), the container is
// deliberately NOT persisted here. The authoritative container lives in the
// issue-pipeline; whoever owns that store provides the real read and replaces
// this placeholder. Until then the loader is inert: it returns null, so
// /staging/send answers `failed` ("container not found") rather than pretending
// to have a container. The endpoint, its contract, and the whole send path
// (resolve tenant -> Octokit -> gate-enforced, idempotent stagePullRequest) are
// live and tested regardless — this is the single remaining cross-lane wire.
//
// The signature is the contract for that replacement: it MUST scope by
// installationId (never resolve a container by id alone) so the tenant guard in
// runStagingSend is defense-in-depth, not the only line.

import type { ApprovedContainer } from './stage-pr.js'

export async function loadApprovedContainer(
  _containerId: string,
  _installationId: string,
): Promise<ApprovedContainer | null> {
  return null
}
