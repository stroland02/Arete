import type { PrismaClient } from "@arete/db";

/**
 * SINGLE SOURCE OF TRUTH for a tenant's connection state.
 *
 * Every dashboard surface (overview, services, agents, dashboards, connections)
 * MUST derive its empty-states and CTAs from this — never from an ad-hoc local
 * check. That is what keeps the UI synchronized with what the account actually
 * has connected, and prevents the "connect a repo" prompt showing when a repo is
 * already connected. See docs/superpowers/specs/2026-07-17-account-state-contract.md.
 *
 * THE THREE-STATE RULE: a surface must distinguish these three stages and never
 * collapse "connected but no activity yet" into "not connected":
 *   - disconnected     → no repository connected. CTA: connect a repository.
 *   - connected_idle   → repo connected, no reviews yet. CTA: connect a model /
 *                        open a PR. NEVER "connect a repository".
 *   - active           → reviews exist. Show the real data.
 */

export type AccountStage = "disconnected" | "connected_idle" | "active";

export interface AccountState {
  /** A repository (installation) is connected. */
  repoConnected: boolean;
  /** How many repositories are connected. */
  repoCount: number;
  /** An AI model is connected — the agents' real dependency. */
  modelConnected: boolean;
  /** At least one review has actually run. */
  hasReviews: boolean;
  /** How many reviews exist across the connected repos. */
  reviewCount: number;
  /** The single canonical lifecycle stage every surface renders from. */
  stage: AccountStage;
}

/** The disconnected state — no repository connected. */
export function disconnectedState(): AccountState {
  return {
    repoConnected: false,
    repoCount: 0,
    modelConnected: false,
    hasReviews: false,
    reviewCount: 0,
    stage: "disconnected",
  };
}

/**
 * Resolve the canonical account state for the caller's authorized installations.
 * Tenant-scoped by `installationIds` (already resolved from the session); pass an
 * empty array for an account with no connected repositories.
 */
export async function getAccountState(
  db: PrismaClient,
  installationIds: string[],
): Promise<AccountState> {
  if (installationIds.length === 0) return disconnectedState();

  const repos = await db.repository.findMany({
    where: { installationId: { in: installationIds } },
    select: { id: true },
  });

  const [modelCount, reviewCount] = await Promise.all([
    db.modelConnection.count({ where: { installationId: { in: installationIds } } }),
    repos.length
      ? db.review.count({ where: { repositoryId: { in: repos.map((r) => r.id) } } })
      : Promise.resolve(0),
  ]);

  const hasReviews = reviewCount > 0;
  return {
    repoConnected: true,
    repoCount: repos.length,
    modelConnected: modelCount > 0,
    hasReviews,
    reviewCount,
    stage: hasReviews ? "active" : "connected_idle",
  };
}
