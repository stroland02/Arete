import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDashboardViewModel, resolveSelectedInstallationIds, getAgentActivity } from "@/lib/queries";
import { getActiveModelConnection } from "@/lib/model-connections-api";
import { AgentsWorkspace } from "@/components/dashboard/agents/agents-workspace";

// Same rationale as the overview: this page reads the session and queries
// Prisma scoped to it on every request, so it must never be statically
// prerendered.
export const dynamic = "force-dynamic";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string; container?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { installation, container } = await searchParams;
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

  // Real per-agent findings for the center conversation pane; empty (honest
  // idle) when there's no access. Same tenant scoping as every other query.
  const activity = viewModel.hasAccess
    ? await getAgentActivity(db, installationIds)
    : [];

  // The agents' real dependency is a connected model — the repo alone can't
  // produce a review. Drives the honest empty-state CTA (connect a model, not
  // a repo, once the repo is already connected).
  const modelConnected =
    installationIds.length > 0 &&
    (await db.modelConnection.count({
      where: { installationId: { in: installationIds } },
    })) > 0;

  // The concrete model every agent runs on today (dynamic; replaces the old
  // hardcoded Opus/Sonnet tier badges). Null when nothing is connected.
  const activeModel = await getActiveModelConnection();

  return (
    <AgentsWorkspace
      findingCountById={Object.fromEntries(
        commentsByCategory.map((c) => [c.category, c.count])
      )}
      totalFindings={commentsByCategory.reduce((sum, c) => sum + c.count, 0)}
      hasReviews={hasReviews}
      activity={activity}
      connected={viewModel.hasAccess}
      modelConnected={modelConnected}
      activeModel={activeModel}
      containerId={container ?? null}
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
