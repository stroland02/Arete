/**
 * Real ContainerStore access for a FIX-born container — resolves an
 * IssueContainer row (created by "Fix it") into the console's container shape,
 * tenancy-scoped. The fix drive (webhook) persists a real transcript on the row
 * as it advances detecting → … → ready | fix_failed; here we project that stored
 * transcript so the console streams the ACTUAL fix steps, never sample data.
 *
 * The container id IS the IssueContainer row id (deep-linked from the work-item
 * panel: /services?container=<id>). A miss (or another tenant's id) returns null
 * and the SSE route falls through to its next source.
 */

import type { ContainerGates, IssueContainer, PullRequest, SynthStep } from "./types";

/** The row slice this projection reads — injectable for tests. */
export interface FixContainerDb {
  issueContainer: {
    findFirst(args: {
      where: { id: string; installationId: { in: string[] } };
    }): Promise<Record<string, unknown> | null>;
  };
}

export async function getFixContainer(
  db: FixContainerDb,
  installationIds: string[],
  id: string,
): Promise<IssueContainer | null> {
  if (installationIds.length === 0) return null;
  const row = await db.issueContainer.findFirst({
    where: { id, installationId: { in: installationIds } },
  });
  if (!row) return null;

  const state = row.state as IssueContainer["state"];
  // A fix container the drive hasn't written a transcript for yet streams an
  // honest single "starting" line — never a fabricated solve.
  const transcript = (Array.isArray(row.transcript) ? row.transcript : []) as SynthStep[];
  const steps: SynthStep[] =
    transcript.length > 0
      ? transcript
      : [{ kind: "dispatch", text: "Fix dispatched — authoring a patch", at: row.createdAt as string }];

  const prRow = (row.pr ?? {}) as { base?: string; branch?: string; title?: string; body?: string };
  const patch = (Array.isArray(row.patch) ? row.patch : []) as { path: string }[];
  const pr: PullRequest = {
    number: null,
    base: prRow.base ?? "main",
    branch: prRow.branch ?? "",
    title: prRow.title ?? "",
    body: prRow.body ?? "",
    comments: [],
    state: state === "ready" ? "ready" : state === "posted" ? "posted" : "composing",
    hostUrl: null,
  };

  const at = row.createdAt as string;
  return {
    id: row.id as string,
    installationId: row.installationId as string,
    serviceId: (prRow.title as string) ?? "fix",
    fingerprint: row.id as string,
    source: "Kuma",
    severity: "medium",
    state,
    firstSeen: at,
    lastSeen: (row.updatedAt as string) ?? at,
    occurrences: 1,
    evidence: [
      {
        key: "fix",
        value:
          state === "ready"
            ? `Patch ready — ${patch.length} file${patch.length === 1 ? "" : "s"}`
            : state === "fix_failed"
              ? "Fix failed"
              : "Authoring a fix",
      },
    ],
    findings: [],
    transcript: steps,
    pr,
    gates: row.gates as ContainerGates,
    createdAt: at,
    updatedAt: (row.updatedAt as string) ?? at,
  };
}
