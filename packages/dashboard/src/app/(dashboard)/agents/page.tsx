import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDashboardViewModel, resolveSelectedInstallationIds, getAgentActivity } from "@/lib/queries";
import { getAccountState } from "@/lib/account-state";
import { getActiveModelConnection } from "@/lib/model-connections-api";
import { getWorkItemInbox } from "@/lib/work-items";
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
  //
  // Stage 4.3: this was an inline `db.modelConnection.count()`, one of the last
  // surfaces re-deriving lifecycle state locally instead of through the single
  // resolver (account-state contract §; getAccountState.modelConnected already
  // counts installation-scoped AND pending user-scoped connections, which the
  // raw count above missed). Session userId flows in so a model connected
  // before the first repo still reads as connected.
  const account = await getAccountState(db, installationIds, session.user.id);
  const modelConnected = account.modelConnected;

  // The concrete model every agent runs on today (dynamic; replaces the old
  // hardcoded Opus/Sonnet tier badges). Null when nothing is connected.
  const activeModel = await getActiveModelConnection();

  // What the agents are working on right now, surfaced in the rail. Null on an
  // unconnected account (nothing to scan) so the section is omitted, not empty.
  // Same tenant scoping as every other query on this page.
  const inbox = viewModel.hasAccess ? await getWorkItemInbox(db, installationIds) : null;

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
      inbox={inbox}
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
