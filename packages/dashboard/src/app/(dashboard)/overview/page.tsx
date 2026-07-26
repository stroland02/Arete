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
/* --- MERGED: PRESERVING UI (HEAD) --- */
import { ActivityList } from "@/components/dashboard/activity-list";
import { AgentsAtWorkStrip } from "@/components/dashboard/agents-at-work-strip";
/* --- MERGED: NEW LOGIC FROM MAIN (COMMENTED OUT FOR REVIEW) --- */
/*
import { SensoriumMap } from "@/components/dashboard/sensorium-map";
import { OverviewSetupCard } from "@/components/dashboard/overview-setup-card";
import { OverviewStatTile } from "@/components/dashboard/overview-stat-tile";
import { DashboardsWorkspace } from "@/components/dashboard/dashboards/dashboards-workspace";
*/
/* --- END MERGE --- */

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

/* --- MERGED: PRESERVING UI (HEAD) --- */
  const connected = viewModel.hasAccess;
  const { totalPrs, criticalBugs, recentReviews, latestReviews, commentsByCategory } = viewModel.hasAccess
    ? viewModel
    : { totalPrs: 0, criticalBugs: 0, recentReviews: 0, latestReviews: [], commentsByCategory: [] };

  const findingCountById = Object.fromEntries(
    commentsByCategory.map((c) => [c.category, c.count])
  );
/* --- MERGED: NEW LOGIC FROM MAIN (COMMENTED OUT FOR REVIEW) --- */
/*
  // Account-State Contract: connection facts + onboarding derive from the single
  // resolver, never ad-hoc hasAccess/totalPrs checks. The userId lets a pending
  // (pre-repo) model connection count as setup step 1 honestly.
  const accountState = await getAccountState(db, installationIds, session.user.id);

  const { totalPrs, criticalBugs, recentReviews, reviewDates } = dashboardsModel.hasAccess
    ? dashboardsModel
    : { totalPrs: 0, criticalBugs: 0, recentReviews: 0, reviewDates: [] as Date[] };
*/
/* --- END MERGE --- */

  const firstName = (session.user.name ?? "").trim().split(" ")[0];

/* --- MERGED: PRESERVING UI (HEAD) --- */
  // Onboarding progress — honest, derived from real state. The setup card
  // disappears once reviews are actually flowing.
  const steps = [
    { label: "Create your Kuma account", done: true },
    { label: "Connect a repository", done: connected },
    { label: "Open a pull request", done: hasReviews },
    { label: "Get your first verified review", done: hasReviews },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const setupComplete = hasReviews;
  const nextStep = steps.find((s) => !s.done);
/* --- MERGED: NEW LOGIC FROM MAIN (COMMENTED OUT FOR REVIEW) --- */
/*
  // Onboarding progress — derived from the Account-State resolver (single source
  // of truth), honest across all stages; the card evolves once reviews flow.
  const setup = deriveOverviewSetup(accountState);
*/
/* --- END MERGE --- */

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

/* --- MERGED: PRESERVING UI (HEAD) --- */
        {/* Setup card (SuperLog-style onboarding) — only while not fully set up */}
        {!setupComplete && (
          <RevealItem>
            <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-content-primary">
                  Finish setting up Kuma
                </h2>
                <span className="font-mono text-xs text-content-muted">
                  {doneCount} of {steps.length}
                </span>
              </div>

              {/* progress bar */}
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent-primary transition-all"
                  style={{ width: `${(doneCount / steps.length) * 100}%` }}
                />
              </div>

              {/* current-step highlight */}
              {nextStep && (
                <div className="mt-5 flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface-0/50 p-5 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-content-primary">{nextStep.label}</p>
                    <p className="mt-0.5 text-xs leading-5 text-content-muted">
                      {nextStep.label === "Connect a repository"
                        ? "Install the Kuma GitHub App on the repo you want reviewed. Every pull request is then reviewed automatically."
                        : "Open a pull request on a connected repository — the six specialists review it and post verified findings back to the PR."}
                    </p>
                  </div>
                  {nextStep.label === "Connect a repository" && (
                    <Link
                      href="/connections"
                      className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90"
                    >
                      Connect a repository
                      <IconArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              )}

              {/* checklist */}
              <ul className="mt-5 space-y-2.5">
                {steps.map((step) => (
                  <li key={step.label} className="flex items-center gap-2.5 text-sm">
                    {step.done ? (
                      <IconCircleCheck className="h-4 w-4 shrink-0 text-accent-success" stroke={2} />
                    ) : (
                      <IconCircleDashed className="h-4 w-4 shrink-0 text-content-muted/60" stroke={2} />
                    )}
                    <span className={step.done ? "text-content-secondary" : "text-content-muted"}>
                      {step.label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
/* --- MERGED: NEW LOGIC FROM MAIN (COMMENTED OUT FOR REVIEW) --- */
/*
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
*/
/* --- END MERGE --- */
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

/* --- MERGED: PRESERVING UI (HEAD) --- */
        {/* Agents at work — the six specialists and what each has caught */}
        <RevealItem className="space-y-3">
          <SectionLabel>Agents at work</SectionLabel>
          <AgentsAtWorkStrip findingCountById={findingCountById} hasReviews={hasReviews} />
        </RevealItem>

        {/* Critical findings */}
/* --- MERGED: NEW LOGIC FROM MAIN (COMMENTED OUT FOR REVIEW) --- */
/*
        {/* Dashboards — the review-pipeline + telemetry charts, folded in from
            the former standalone /dashboards page (one home, not two tabs). */}
*/
/* --- END MERGE --- */
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
