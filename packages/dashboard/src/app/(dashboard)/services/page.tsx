import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getConnectedRepositories, getServicesInbox, resolveSelectedInstallationIds } from "@/lib/queries";
import { getWorkItemInbox } from "@/lib/work-items";
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
  const [reviewGroups, repositories, inbox] = connected
    ? await Promise.all([
        getServicesInbox(db, installationIds),
        getConnectedRepositories(db, installationIds),
        getWorkItemInbox(db, installationIds),
      ])
    : [[], [], null];

  return (
    <ServicesWorkspace
      connected={connected}
      containerId={container ?? null}
      reviewGroups={reviewGroups}
      repositories={repositories}
      inbox={inbox}
    />
  );
}
