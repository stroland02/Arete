import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveSelectedInstallationIds } from "@/lib/queries";
import { getIncidents } from "@/lib/incidents";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { IncidentsWorkspace } from "@/components/dashboard/incidents/incidents-workspace";

// Session-scoped like every dashboard page; never statically prerendered.
export const dynamic = "force-dynamic";

// Incidents inbox — alerts Kuma's own monitoring opened (Prometheus →
// Alertmanager → the receiver), tenant-scoped exactly like every dashboard
// query. The workspace filters these REAL incidents by status (Open / Resolved
// / Noise / All) and each row links through to the fix run it opened at
// /incidents/[id]. Real data only: no incidents => honest per-filter empty
// state, never a fabricated incident. Preserves any `?installation=` selection.
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
      <PageReveal className="space-y-6">
        <RevealItem>
          <h1 className="text-2xl font-semibold tracking-tight text-content-primary">
            Incidents
          </h1>
          <p className="mt-1 text-sm text-content-muted">
            Investigate operational incidents from first signal to resolution.
          </p>
        </RevealItem>

        <RevealItem>
          <IncidentsWorkspace incidents={incidents} installationId={installationIds[0] ?? null} />
        </RevealItem>
      </PageReveal>
    </div>
  );
}
