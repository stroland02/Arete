/**
 * IssueContainer persistence — the WRITE side of the Fix workflow (Wave-2 Part A).
 *
 * The driver streams live but persisted nothing, so Eng1's gate-enforced
 * `loadApprovedContainer` (packages/webhook) could only ever 404. This adapter
 * durably records a Fix run in the @arete/db `IssueContainer` model:
 *   • create()  — when a Fix run starts (scoped by installationId).
 *   • save()    — on each driver transition (state) and on approval (gates).
 *   • load()    — read back, tenancy-scoped, so the approve route can enforce the
 *                 409-if-not-ready gate against STORED state, not a request body.
 *
 * The JSON columns are written in the EXACT shape Eng1 reads
 * (packages/webhook/src/staging/load-container.ts → ApprovedContainer):
 *   gates  { solutionApprovedAt: ISO8601 | null, ... }   — the send gate
 *   target { owner, repo }                                — the PR target repo
 *   pr     { base, title, body }                          — the PR metadata
 *   patch  StagedPatchFile[] { path, content }            — the diff to commit
 * `state` is our ContainerState string; the loader treats it as informational
 * (staging gates purely on gates.solutionApprovedAt), so the two lanes agree
 * without sharing a code module.
 *
 * Schema is single-owner (Eng1); this NEVER edits it — it only reads/writes rows
 * via the injected Prisma client (injectable so it is unit-tested with a fake db,
 * same pattern as users.ts / queries.ts).
 */

import type { ContainerGates, ContainerState, Finding, IssueContainer } from "./types";

/** One composed file of the patch — path + full new content. Structurally the
 *  same wire contract as webhook's StagedPatchFile; defined locally so the
 *  dashboard never imports across the package boundary. */
export interface StagedPatchFile {
  path: string;
  content: string;
}

/** Everything the row needs that the domain container does not itself carry:
 *  the target repo (from the review's Repository) and the fix author's patch. */
export interface PersistContainerInput {
  container: IssueContainer;
  target: { owner: string; repo: string };
  patch: StagedPatchFile[];
}

/** The projection load() returns — enough to gate approval and re-stage the row. */
export interface StoredContainer {
  id: string;
  installationId: string;
  state: ContainerState;
  gates: ContainerGates;
  target: { owner: string; repo: string };
  pr: { base: string; title: string; body: string };
  patch: StagedPatchFile[];
  findings: Finding[];
}

/** The slice of Prisma this store uses — injectable for tests. */
export interface ContainerDb {
  issueContainer: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findFirst(args: {
      where: { id: string; installationId: string };
    }): Promise<Record<string, unknown> | null>;
    updateMany(args: {
      where: { id: string; installationId: string };
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

function prColumn(container: IssueContainer): { base: string; title: string; body: string } {
  const pr = container.pr;
  return pr ? { base: pr.base, title: pr.title, body: pr.body } : { base: "", title: "", body: "" };
}

export class PrismaContainerStore {
  constructor(private readonly db: ContainerDb) {}

  /** Create the container row when a Fix run starts. */
  async create(input: PersistContainerInput): Promise<void> {
    const { container, target, patch } = input;
    await this.db.issueContainer.create({
      data: {
        id: container.id,
        installationId: container.installationId,
        state: container.state,
        gates: container.gates,
        target,
        pr: prColumn(container),
        patch,
        findings: container.findings,
      },
    });
  }

  /** Read a container back, ALWAYS scoped by (id, installationId) — a container
   *  can never be resolved by id alone (tenancy). A miss returns null. */
  async load(id: string, installationId: string): Promise<StoredContainer | null> {
    const row = await this.db.issueContainer.findFirst({ where: { id, installationId } });
    if (!row) return null;
    return {
      id: row.id as string,
      installationId: row.installationId as string,
      state: row.state as ContainerState,
      gates: row.gates as ContainerGates,
      target: row.target as { owner: string; repo: string },
      pr: row.pr as { base: string; title: string; body: string },
      patch: (row.patch as StagedPatchFile[]) ?? [],
      findings: (row.findings as Finding[]) ?? [],
    };
  }

  /** Advance the stored container's state (each transition) and/or gates (on
   *  approval). Scoped by (id, installationId): a non-matching tenant updates
   *  zero rows and returns false — never a cross-tenant write. */
  async save(
    id: string,
    installationId: string,
    patch: { state: ContainerState; gates: ContainerGates },
  ): Promise<boolean> {
    const { count } = await this.db.issueContainer.updateMany({
      where: { id, installationId },
      data: { state: patch.state, gates: patch.gates },
    });
    return count > 0;
  }
}
