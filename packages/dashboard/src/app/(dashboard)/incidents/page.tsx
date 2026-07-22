import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveSelectedInstallationIds } from "@/lib/queries";
import { getIncidents } from "@/lib/incidents";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { IncidentList } from "@/components/dashboard/incidents/incident-list";

// Session-scoped like every dashboard page; never statically prerendered.
export const dynamic = "force-dynamic";

// Incidents inbox — alerts Kuma's own monitoring opened (Prometheus →
// Alertmanager → the receiver), tenant-scoped exactly like every dashboard
// query. Each row links through to the fix run it opened at /incidents/[id].
// This is real data only: an account whose monitoring hasn't fired anything
// gets the honest empty state, never a fabricated incident. Preserves any
// `?installation=` selection so the sidebar entry and deep links agree.
export default async function IncidentsPage({
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
  const incidents = await getIncidents(db, installationIds);

  return (
    <div className="mx-auto max-w-5xl">
      <PageReveal className="space-y-8">
        <RevealItem>
          <h1 className="text-2xl font-semibold tracking-tight text-content-primary">
            Incidents
          </h1>
          <p className="mt-1 text-sm text-content-muted">
            Alerts Kuma&apos;s own monitoring opened — each links through to the fix run it started.
          </p>
        </RevealItem>

        <RevealItem>
          {incidents.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-border-default bg-surface-1">
              <IncidentList incidents={incidents} />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border border-border-default bg-surface-1 p-5">
              <p className="text-sm text-content-secondary">
                No incidents — Kuma will open one automatically if its own monitoring fires an alert.
              </p>
            </div>
          )}
        </RevealItem>
      </PageReveal>
    </div>
  );
}
