import Link from "next/link";
import { redirect } from "next/navigation";
import { IconArrowRight, IconLayoutDashboard } from "@tabler/icons-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDashboardsViewModel, resolveSelectedInstallationIds } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
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

      {model.hasAccess ? (
        <DashboardsWorkspace model={model} />
      ) : (
        <Card>
          <EmptyState
            icon={<IconLayoutDashboard className="h-6 w-6" />}
            title="No data yet"
            description="Connect a repository — once Areté reviews a pull request, your dashboards fill in automatically."
          />
          <div className="mt-4 flex justify-center">
            <Link href="/connections" className="inline-flex items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/30">
              Connect a repository <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
