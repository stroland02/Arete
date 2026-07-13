/**
 * Real ContainerStore access — resolves an IssueContainer from a stored Kuma
 * review, tenancy-scoped. This is what the live SSE route reads, so the product
 * path serves ONLY real reviews (never sample data); when a review doesn't
 * exist or isn't the caller's, it returns null and the console shows empty.
 *
 * The container id IS the review id (deep-linkable: /agents?container=<reviewId>).
 * Tenancy is enforced by getReviewDetail's own installationId filter.
 */

import { getReviewDetail } from "@/lib/queries";
import { reviewToContainer } from "./review-projection";
import type { IssueContainer } from "./types";

export async function getReviewContainer(
  db: Parameters<typeof getReviewDetail>[0],
  installationIds: string[],
  id: string,
): Promise<IssueContainer | null> {
  const review = await getReviewDetail(db, installationIds, id);
  if (!review) return null;
  return reviewToContainer(
    { ...review, createdAt: review.createdAt.toISOString() },
    installationIds[0] ?? "",
  );
}
