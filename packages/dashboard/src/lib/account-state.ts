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
  /**
   * An AI model is connected — the agents' real dependency. True for an
   * installation-scoped connection OR a pending user-scoped one (model can be
   * connected before any repo; adopted by the first installation).
   */
  modelConnected: boolean;
  /** At least one review has actually run. */
  hasReviews: boolean;
  /** How many reviews exist across the connected repos. */
  reviewCount: number;
  /** At least one repo scan finished ("complete" | "no_findings") — the first proof the repo+model pair works. */
  scanCompleted: boolean;
  /** At least one telemetry service (GitHub Actions, PostHog, Vercel, Stripe…) is connected. */
  telemetryConnected: boolean;
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
    scanCompleted: false,
    telemetryConnected: false,
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
  userId?: string,
): Promise<AccountState> {
  if (installationIds.length === 0) {
    // No repo yet — but the user may already have a PENDING model connection
    // (model is setup step 1; adopted by the first installation). Surface it
    // honestly; stage stays "disconnected" (repo is the stage driver).
    if (!userId) return disconnectedState();
    const pendingModels = await db.modelConnection.count({
      where: { userId, installationId: null },
    });
    return { ...disconnectedState(), modelConnected: pendingModels > 0 };
  }

  const repos = await db.repository.findMany({
    where: { installationId: { in: installationIds } },
    select: { id: true },
  });

  const [modelCount, reviewCount, scanCount, telemetryCount] = await Promise.all([
    db.modelConnection.count({
      where: userId
        ? { OR: [{ installationId: { in: installationIds } }, { userId, installationId: null }] }
        : { installationId: { in: installationIds } },
    }),
    repos.length
      ? db.review.count({ where: { repositoryId: { in: repos.map((r) => r.id) } } })
      : Promise.resolve(0),
    db.scanRun.count({
      where: {
        installationId: { in: installationIds },
        status: { in: ["complete", "no_findings"] },
      },
    }),
    db.telemetryConnection.count({ where: { installationId: { in: installationIds } } }),
  ]);

  const hasReviews = reviewCount > 0;
  return {
    repoConnected: true,
    repoCount: repos.length,
    modelConnected: modelCount > 0,
    hasReviews,
    reviewCount,
    scanCompleted: scanCount > 0,
    telemetryConnected: telemetryCount > 0,
    stage: hasReviews ? "active" : "connected_idle",
  };
}
