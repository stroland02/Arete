import { redirect } from "next/navigation";
import Link from "next/link";
import { IconArrowRight } from "@tabler/icons-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDashboardsViewModel, resolveSelectedInstallationIds } from "@/lib/queries";
import { getSensoriumViewModel } from "@/lib/sensorium";
import { getAccountState } from "@/lib/account-state";
import { deriveOverviewSetup } from "@/lib/overview-setup";
import { bucketByDay } from "@/lib/trends";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { SensoriumMap } from "@/components/dashboard/sensorium-map";
import { OverviewSetupCard } from "@/components/dashboard/overview-setup-card";
import { OverviewStatTile } from "@/components/dashboard/overview-stat-tile";
import { DashboardsWorkspace } from "@/components/dashboard/dashboards/dashboards-workspace";

// This page reads the session and queries Prisma scoped to it on every
// request — it must never be statically prerendered (that would either fail
// at build time for lack of a session, or worse, bake one user's tenant data
// into a page served to everyone). `force-dynamic` makes that explicit.
export const dynamic = "force-dynamic";

export default async function DashboardOverview({
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

  // One tenant-scoped aggregate powers both the stat tiles and the dashboards
  // presets (Review Activity / Findings / Telemetry) — Overview is the single
  // home, and this is its single activity view-model.
  const dashboardsModel = await getDashboardsViewModel(db, installationIds);
  // The Sensorium code graph is keyed by the GitHub external installation id,
  // not the DB uuid — resolve the primary selected installation's externalId.
  const graphExternalId = (session.installations ?? []).find(
    (i) => i.id === installationIds[0]
  )?.externalId;
  const sensorium = await getSensoriumViewModel(db, installationIds, graphExternalId);

  // Account-State Contract: connection facts + onboarding derive from the single
  // resolver, never ad-hoc hasAccess/totalPrs checks. The userId lets a pending
  // (pre-repo) model connection count as setup step 1 honestly.
  const accountState = await getAccountState(db, installationIds, session.user.id);

  const { totalPrs, criticalBugs, recentReviews, reviewDates } = dashboardsModel.hasAccess
    ? dashboardsModel
    : { totalPrs: 0, criticalBugs: 0, recentReviews: 0, reviewDates: [] as Date[] };

  const firstName = (session.user.name ?? "").trim().split(" ")[0];

  // Onboarding progress — derived from the Account-State resolver (single source
  // of truth), honest across all stages; the card evolves once reviews flow.
  const setup = deriveOverviewSetup(accountState);

  return (
    <div className="mx-auto max-w-5xl">
      <PageReveal className="space-y-10">
        {/* Greeting */}
        <RevealItem>
          <h1 className="text-2xl font-semibold tracking-tight text-content-primary">
            Good to see you{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="mt-1 text-sm text-content-muted">
            Here&apos;s what Kuma is doing for your code.
          </p>
        </RevealItem>

        {/* Sensorium — a live map of your codebase (real nodes from the code
            graph, with pain/activity sensor overlays). Honest empty state until
            a review has indexed the repo; never a fabricated graph. */}
        {sensorium.hasAccess && (
          <RevealItem className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel>Code map</SectionLabel>
              <Link
                href="/map"
                className="inline-flex items-center gap-1 text-xs text-accent-primary hover:text-accent-primary/80"
              >
                Open map <IconArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {sensorium.available ? (
              <SensoriumMap topology={sensorium.topology!} sensors={sensorium.sensors!} />
            ) : (
              <StatePanel>
                {sensorium.reason ?? "Kuma is building your code map from your connected repository."}
              </StatePanel>
            )}
          </RevealItem>
        )}

        {/* Onboarding → next-action card. It never disappears: once setup is
            done it evolves into the "act on what Kuma found" step of the
            workflow, so the user always has a clear next move. */}
        <RevealItem>
          <OverviewSetupCard setup={setup} criticalBugs={criticalBugs} />
        </RevealItem>

        {/* Metric tiles — real counts, real daily buckets (no trend when the
            series doesn't exist yet). */}
        <RevealItem>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <OverviewStatTile
              label="Pull requests reviewed"
              value={totalPrs}
              trend={reviewDates.length > 0 ? bucketByDay(reviewDates, 30) : undefined}
            />
            <OverviewStatTile label="Critical issues caught" value={criticalBugs} />
            <OverviewStatTile
              label="Reviews this week"
              value={recentReviews}
              trend={reviewDates.length > 0 ? bucketByDay(reviewDates, 7) : undefined}
            />
          </div>
        </RevealItem>

        {/* Dashboards — the review-pipeline + telemetry charts, folded in from
            the former standalone /dashboards page (one home, not two tabs). */}
        <RevealItem className="space-y-3">
          <SectionLabel>Dashboards</SectionLabel>
          <DashboardsWorkspace model={dashboardsModel} accountState={accountState} />
        </RevealItem>
      </PageReveal>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
      {children}
    </h2>
  );
}

function StatePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border-default bg-surface-1 p-5">
      <p className="text-sm text-content-secondary">{children}</p>
    </div>
  );
}
