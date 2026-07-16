import { redirect } from "next/navigation";
import Link from "next/link";
import {
  IconArrowRight,
  IconCircleCheck,
  IconCircleDashed,
  IconShieldCheck,
} from "@tabler/icons-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDashboardViewModel, resolveSelectedInstallationIds } from "@/lib/queries";
import { getSensoriumViewModel } from "@/lib/sensorium";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { ActivityList } from "@/components/dashboard/activity-list";
import { AgentsAtWorkStrip } from "@/components/dashboard/agents-at-work-strip";
import { SensoriumMap } from "@/components/dashboard/sensorium-map";

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

  const viewModel = await getDashboardViewModel(db, installationIds);
  const sensorium = await getSensoriumViewModel(db, installationIds);

  const connected = viewModel.hasAccess;
  const { totalPrs, criticalBugs, recentReviews, latestReviews, commentsByCategory } = viewModel.hasAccess
    ? viewModel
    : { totalPrs: 0, criticalBugs: 0, recentReviews: 0, latestReviews: [], commentsByCategory: [] };

  const findingCountById = Object.fromEntries(
    commentsByCategory.map((c) => [c.category, c.count])
  );

  const hasReviews = connected && totalPrs > 0;
  const firstName = (session.user.name ?? "").trim().split(" ")[0];

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
            <SectionLabel>Code map</SectionLabel>
            {sensorium.available ? (
              <SensoriumMap topology={sensorium.topology!} sensors={sensorium.sensors!} />
            ) : (
              <StatePanel>
                {sensorium.reason ?? "Kuma is building your code map from your connected repository."}
              </StatePanel>
            )}
          </RevealItem>
        )}

        {/* Onboarding → next-action card. It never disappears: once a repo is
            connected and reviews are flowing, it evolves from the setup
            checklist into the "act on what Kuma found" step of the workflow,
            so the user always has a clear next move. */}
        <RevealItem>
          <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
            {setupComplete ? (
              /* Setup done — point at acting on findings (the next step in how
                 Kuma actually resolves what it found). */
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-content-primary">
                    You&apos;re set up — here&apos;s what&apos;s next
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent-success/25 bg-accent-success/10 px-2 py-0.5 text-[10px] font-medium text-accent-success">
                    <IconCircleCheck className="h-3 w-3" stroke={2.25} />
                    Setup complete
                  </span>
                </div>

                <div className="mt-5 flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface-0/50 p-5 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-content-primary">
                      {criticalBugs > 0
                        ? `Act on ${criticalBugs} critical finding${criticalBugs === 1 ? "" : "s"} Kuma caught`
                        : "Review Kuma's findings and approve fixes"}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-content-muted">
                      Each finding comes with a proposed fix and the evidence behind it. Open the
                      Services workspace to review it, approve the change, and let Kuma open the
                      pull request.
                    </p>
                  </div>
                  <Link
                    href="/services"
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90"
                  >
                    Review findings
                    <IconArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </>
            ) : (
              /* Still setting up — the SuperLog-style checklist. */
              <>
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
              </>
            )}
          </section>
        </RevealItem>

        {/* Metric tiles */}
        <RevealItem>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label="Pull requests reviewed" value={totalPrs} />
            <StatTile label="Critical issues caught" value={criticalBugs} />
            <StatTile label="Reviews this week" value={recentReviews} />
          </div>
        </RevealItem>

        {/* Agents at work — the six specialists and what each has caught */}
        <RevealItem className="space-y-3">
          <SectionLabel>Agents at work</SectionLabel>
          <AgentsAtWorkStrip findingCountById={findingCountById} hasReviews={hasReviews} />
        </RevealItem>

        {/* Critical findings */}
        <RevealItem className="space-y-3">
          <SectionLabel>Critical findings</SectionLabel>
          {criticalBugs > 0 ? (
            <div className="flex items-center gap-3 rounded-2xl border border-accent-danger/30 bg-accent-danger/5 p-5">
              <IconShieldCheck className="h-5 w-5 shrink-0 text-accent-danger" stroke={1.75} />
              <p className="text-sm text-content-secondary">
                <span className="font-semibold text-content-primary">{criticalBugs}</span> critical
                {criticalBugs === 1 ? " issue" : " issues"} caught across your recent reviews.
              </p>
            </div>
          ) : (
            <StatePanel
              icon={<IconShieldCheck className="h-5 w-5 text-accent-success" stroke={1.75} />}
            >
              All clear — no critical findings in your recent reviews.
            </StatePanel>
          )}
        </RevealItem>

        {/* Recent reviews */}
        <RevealItem className="space-y-3">
          <SectionLabel>Recent reviews</SectionLabel>
          {latestReviews.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-border-default bg-surface-1">
              <ActivityList
                reviews={latestReviews.map((review) => ({
                  id: review.id,
                  repositoryName: review.repositoryFullName,
                  prNumber: review.prNumber,
                  createdAt: review.createdAt.toISOString(),
                  riskLevel: review.riskLevel,
                }))}
              />
            </div>
          ) : (
            <StatePanel>
              {connected ? (
                <>Open a pull request on a connected repository and its review appears here.</>
              ) : (
                <span className="inline-flex flex-wrap items-center gap-x-1.5">
                  No reviews yet — connect a repository to get started.
                  <Link
                    href="/connections"
                    className="inline-flex items-center gap-1 font-medium text-accent-primary hover:underline"
                  >
                    Connect a repository <IconArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </span>
              )}
            </StatePanel>
          )}
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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-1 p-5">
      <p className="font-mono text-3xl font-semibold tabular-nums text-content-primary">{value}</p>
      <p className="mt-1 text-xs text-content-muted">{label}</p>
    </div>
  );
}

function StatePanel({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border-default bg-surface-1 p-5">
      {icon && <span className="shrink-0">{icon}</span>}
      <p className="text-sm text-content-secondary">{children}</p>
    </div>
  );
}
