// Projection of a PERSISTED IssueContainer row (the fix worker's writes) into
// the domain IssueContainer the console/stream/approve paths consume. The row
// stores exactly what the healing loop recorded — state, gates, target, pr,
// patch, findings, transcript. Fields the row does not carry get honest
// neutral constants (never fabricated findings or severity theater). Legacy
// 'open' rows (pre-healing-loop) are not pipeline states → null, so callers
// fall through to their next source (review projection / sample).

import type { PrismaClient } from '@arete/db';
import type { ContainerGates, ContainerState, IssueContainer, PullRequest, SynthStep } from './types';

const PIPELINE_STATES: ReadonlySet<string> = new Set([
  'detecting',
  'fanning_out',
  'verifying',
  'composing',
  'ready',
  'solution_approved',
  'posted',
  'changes_requested',
  'merged',
  'dismissed',
  'fix_failed',
]);

type StoredDb = {
  issueContainer: { findFirst(args: unknown): Promise<Record<string, unknown> | null> };
};

export async function getStoredContainer(
  db: StoredDb | PrismaClient,
  installationIds: string[],
  id: string,
): Promise<IssueContainer | null> {
  if (installationIds.length === 0) return null;
  const row = await (db as StoredDb).issueContainer.findFirst({
    where: { id, installationId: { in: installationIds } },
  });
  if (!row || typeof row.state !== 'string' || !PIPELINE_STATES.has(row.state)) return null;

  const target = (row.target ?? null) as { owner?: string; repo?: string } | null;
  const prJson = (row.pr ?? null) as
    | { base?: string; branch?: string; title?: string; body?: string; url?: string }
    | null;
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? '');
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : createdAt;

  const pr: PullRequest | null = prJson?.title
    ? {
        number: null,
        base: prJson.base ?? 'main',
        branch: prJson.branch ?? '',
        title: prJson.title,
        body: prJson.body ?? '',
        comments: [],
        state: 'ready',
        hostUrl: prJson.url ?? null,
      }
    : null;

  return {
    id: String(row.id),
    installationId: String(row.installationId),
    serviceId: target?.owner && target?.repo ? `${target.owner}/${target.repo}` : 'repository',
    fingerprint: '',
    source: 'work_item',
    severity: 'medium',
    state: row.state as ContainerState,
    firstSeen: createdAt,
    lastSeen: updatedAt,
    occurrences: 1,
    evidence: [],
    findings: [],
    transcript: (Array.isArray(row.transcript) ? row.transcript : []) as SynthStep[],
    pr,
    gates: (row.gates ?? {
      solutionApprovedAt: null,
      solutionApprovedBy: null,
      postedAt: null,
      postedBy: null,
    }) as ContainerGates,
    createdAt,
    updatedAt,
  };
}
