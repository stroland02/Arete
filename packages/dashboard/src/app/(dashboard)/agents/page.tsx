import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDashboardViewModel, resolveSelectedInstallationIds, getAgentActivity } from "@/lib/queries";
import { AgentsWorkspace } from "@/components/dashboard/agents/agents-workspace";

// Same rationale as the overview: this page reads the session and queries
// Prisma scoped to it on every request, so it must never be statically
// prerendered.
export const dynamic = "force-dynamic";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { installation } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(
    session.installations ?? [],
    installation
  );

  const viewModel = await getDashboardViewModel(db, installationIds);

  // Honest zero-state on a fresh account: no fabricated counts, the console
  // shows its idle state, and the PR panel says "No pull request yet".
  const { totalPrs, commentsByCategory, latestReviews } = viewModel.hasAccess
    ? viewModel
    : { totalPrs: 0, commentsByCategory: [], latestReviews: [] };

  const hasReviews = viewModel.hasAccess && totalPrs > 0;
  const latest = latestReviews[0];

  const activity = viewModel.hasAccess
    ? await getAgentActivity(db, installationIds)
    : [];

  return (
    <AgentsWorkspace
      findingCountById={Object.fromEntries(
        commentsByCategory.map((c) => [c.category, c.count])
      )}
      totalFindings={commentsByCategory.reduce((sum, c) => sum + c.count, 0)}
      hasReviews={hasReviews}
      activity={activity}
      latestReview={
        latest
          ? {
              repoFullName: latest.repositoryFullName,
              prNumber: latest.prNumber,
              riskLevel: latest.riskLevel,
            }
          : null
      }
    />
  );
}
