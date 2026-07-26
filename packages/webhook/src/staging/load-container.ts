// Integration seam: resolve an approved IssueContainer by id, scoped to its
// tenant, for POST /staging/send.
//
// The container is now persisted in @arete/db as the IssueContainer model
// (Eng1-owned). The dashboard/driver populate it (create / advance / approve);
// this loader reads it. The read is ALWAYS scoped by BOTH id AND installationId
// (findFirst with both in the WHERE), so a container can never be resolved by id
// alone — the tenant guard in runStagingSend is defense-in-depth, not the only
// line. A miss returns null, which runStagingSend maps to the `not_found`
// outcome (HTTP 404).
//
// The read is NOT gate-filtered: an un-approved container still loads (with
// gates.solutionApprovedAt === null). The gate is enforced downstream by
// stagePullRequest, which returns `not_approved` (HTTP 409) — a distinct signal
// from a container that doesn't exist (404).

import type { ApprovedContainer } from './stage-pr.js'

/** Row shape read from IssueContainer — the JSON columns carry the ApprovedContainer
 *  projection the dashboard/driver wrote. */
interface IssueContainerRow {
  id: string
  installationId: string
  gates: { solutionApprovedAt: string | Date | null }
  target: { owner: string; repo: string }
  pr: { base: string; title: string; body: string }
  patch: ApprovedContainer['patch']
}

export interface LoadContainerDeps {
  prisma: {
    issueContainer: {
      findFirst(args: unknown): Promise<IssueContainerRow | null>
    }
  }
}

function defaultDeps(): LoadContainerDeps {
  return {
    prisma: {
      issueContainer: {
        findFirst: async (args) => {
          const { prisma } = await import('../db.js')
          return prisma.issueContainer.findFirst(args as never) as Promise<IssueContainerRow | null>
        },
      },
    },
  }
}

export async function loadApprovedContainer(
  containerId: string,
  installationId: string,
  deps: LoadContainerDeps = defaultDeps(),
): Promise<ApprovedContainer | null> {
  const row = await deps.prisma.issueContainer.findFirst({
    where: { id: containerId, installationId },
  })
  if (!row) return null

  const approvedAt = row.gates.solutionApprovedAt
  return {
    id: row.id,
    installationId: row.installationId,
    target: row.target,
    pr: row.pr,
    patch: row.patch,
    gates: {
      solutionApprovedAt: approvedAt ? new Date(approvedAt) : null,
    },
  }
}
