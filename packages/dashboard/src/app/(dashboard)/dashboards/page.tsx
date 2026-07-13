import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDashboardsViewModel, resolveSelectedInstallationIds } from "@/lib/queries";
import { DashboardsWorkspace } from "@/components/dashboard/dashboards/dashboards-workspace";

export const dynamic = "force-dynamic";

export default async function DashboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { installation } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], installation);
  const model = await getDashboardsViewModel(db, installationIds);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold text-content-primary">Dashboards</h1>
        <p className="text-sm text-content-muted">Your review pipeline and connected telemetry, at a glance.</p>
      </div>
      <DashboardsWorkspace model={model} />
    </div>
  );
}
