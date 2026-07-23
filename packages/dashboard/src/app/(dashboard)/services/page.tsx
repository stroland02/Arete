import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getConnectedRepositories,
  getServicesInbox,
  resolveSelectedInstallationIds,
  getAgentActivity,
  getDashboardViewModel,
} from "@/lib/queries";
import { getWorkItemInbox } from "@/lib/work-items";
import { getPendingApprovals } from "@/lib/approvals";
import { getAccountState } from "@/lib/account-state";
import { getActiveModelConnection } from "@/lib/model-connections-api";
import { ServicesWorkspace } from "@/components/dashboard/services/services-workspace";

// Session-scoped like every dashboard page; never statically prerendered.
export const dynamic = "force-dynamic";

// Services "Triage Inbox" — the connected repo's real reviews, grouped per
// repository (the "service"). Each review is a selectable PR; selecting one
// streams its real Synthesizer transcript via /api/containers/[id]/stream (the
// container id IS the review id). No sample data and no fabricated fixes —
// only reviews that actually ran. An account with no reviews yet gets the
// honest empty state, which routes to /connections.
export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ container?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { container } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], undefined);
  const connected = installationIds.length > 0;
  // Stage 2.2 adds the agents layer, so this page now also loads what a
  // specialist's conversation needs. All of it is tenant-scoped through the
  // same installationIds as everything else; a disconnected account short-
  // circuits to honest empties rather than querying.
  const [reviewGroups, repositories, inbox, approvals, activity, viewModel, account] = connected
    ? await Promise.all([
        getServicesInbox(db, installationIds),
        getConnectedRepositories(db, installationIds),
        getWorkItemInbox(db, installationIds),
        getPendingApprovals(db, installationIds),
        getAgentActivity(db, installationIds),
        getDashboardViewModel(db, installationIds),
        getAccountState(db, installationIds, session.user.id),
      ])
    : [[], [], null, [], [], null, null];

  // Counted once here so the rail badge and the conversation header cannot
  // disagree — the same reason the work-item triage counter derives from the
  // panel's own rule rather than a parallel one.
  const findingCountById = Object.fromEntries(
    (viewModel?.hasAccess ? viewModel.commentsByCategory : []).map((c) => [c.category, c.count]),
  );

  // The model every agent actually runs on. Resolved even when disconnected so
  // the drawer can say which model it would use.
  const activeModel = await getActiveModelConnection();

  return (
    <ServicesWorkspace
      connected={connected}
      containerId={container ?? null}
      reviewGroups={reviewGroups}
      repositories={repositories}
      inbox={inbox}
      approvals={approvals}
      activity={activity}
      findingCountById={findingCountById}
      activeModel={activeModel}
      modelConnected={account?.modelConnected ?? false}
    />
  );
}
