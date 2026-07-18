/**
 * persistDrive — the durable Fix-run write path (Wave-2 Part A).
 *
 * Ties the pure advance-engine (driveContainer) to the persistent store so a Fix
 * run is recorded, not just streamed:
 *   1. create the container row when the run STARTS (scoped by installationId);
 *   2. run the pure driver (detecting → ready);
 *   3. save the resolved state + gates + composed PR metadata.
 *
 * The driver is atomic and pure, so it resolves the whole advance in one call;
 * persistence brackets it (create at start, save at the resolved state). The
 * INCREMENTAL per-transition harness — re-running a specialist and re-verifying
 * between real transitions — is the live Python driver's job (Phase B); it calls
 * store.save() on each real transition. This TS path owns the create + the
 * resolved persist, honestly, without pretending to a step cadence the pure
 * engine does not have.
 *
 * HITL moat: the driver never crosses `ready`. persistDrive persists exactly the
 * driver's terminal state and NEVER stamps gates.solutionApprovedAt — only the
 * human approve route does that. So a persisted run is approvable, never
 * auto-approved and never auto-sent.
 */

import { driveContainer, type DriveInput, type DriveResult } from "./driver";
import type { PersistContainerInput, PrismaContainerStore, StagedPatchFile } from "./container-persistence";

export interface FixRunMeta {
  /** The PR target repository (from the review's Repository). */
  target: { owner: string; repo: string };
  /** The fix author's composed patch. Empty until the live harness authors code
   *  — never fabricated here. */
  patch: StagedPatchFile[];
}

export async function persistDrive(
  store: PrismaContainerStore,
  input: DriveInput,
  meta: FixRunMeta,
): Promise<DriveResult> {
  const created: PersistContainerInput = { container: input.container, target: meta.target, patch: meta.patch };
  // 1. Fix run starts → create the row (at `detecting`).
  await store.create(created);

  // 2. Pure advance engine (detecting → ready | escalated). No I/O.
  const result = driveContainer(input);

  // 3. Persist the resolved state + gates, and the composed PR once ready.
  const { id, installationId } = input.container;
  const pr = result.container.pr;
  await store.save(id, installationId, {
    state: result.container.state,
    gates: result.container.gates,
    ...(pr ? { pr: { base: pr.base, title: pr.title, body: pr.body } } : {}),
  });

  return result;
}
