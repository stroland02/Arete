import Link from "next/link";
import { redirect } from "next/navigation";
import { IconExternalLink, IconLayoutGrid } from "@tabler/icons-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMasterGridSnapshots, resolveSelectedInstallationIds } from "@/lib/queries";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";

export const dynamic = "force-dynamic";

const PROVIDER_LABELS: Record<string, string> = {
  sentry: "Sentry",
  vercel: "Vercel",
  stripe: "Stripe",
  posthog: "PostHog",
  github_actions: "GitHub Actions",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function MasterGridPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { installation } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], installation);
  const connected = installationIds.length > 0;
  const snapshots = await getMasterGridSnapshots(db, installationIds);

  return (
    <PageReveal className="space-y-6">
      <RevealItem>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-content-primary">Master Grid</h1>
          <p className="text-sm text-content-muted">
            What your connected sources looked like as of your most recent review — not a live
            feed. Each card refreshes the next time Kuma reviews a PR that reads it.
          </p>
        </div>
      </RevealItem>

      <RevealItem>
        {snapshots.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconLayoutGrid className="w-6 h-6" />}
              title={connected ? "Connected — no telemetry snapshots yet" : "No telemetry snapshots yet"}
              description={
                connected
                  ? "Your repository is connected. Open a pull request — the next review will populate this grid."
                  : "Connect a repository and merge a PR — the next review will populate this grid."
              }
            />
            {!connected && (
              <div className="flex justify-center mt-2">
                <Link href="/connections" className="text-sm text-accent-primary hover:text-accent-primary/80">
                  Connect a repository →
                </Link>
              </div>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {snapshots.map((snapshot) => (
              <Card key={`${snapshot.provider}:${snapshot.sourceRef}`}>
                <CardHeader>
                  <CardTitle className="text-base">{providerLabel(snapshot.provider)}</CardTitle>
                  <span className="text-xs text-content-muted font-mono">{snapshot.sourceRef}</span>
                </CardHeader>

                <p className="text-sm text-content-secondary">{snapshot.summaryText}</p>

                {Object.keys(snapshot.metrics).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    {Object.entries(snapshot.metrics).map(([key, value]) => (
                      <span
                        key={key}
                        className="text-xs font-mono px-2 py-1 rounded-lg bg-content-primary/5 border border-border-subtle text-content-secondary"
                      >
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-subtle">
                  <span className="text-xs text-content-muted">{timeAgo(snapshot.fetchedAt)}</span>
                  {snapshot.links[0] && (
                    <a
                      href={snapshot.links[0]}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent-primary hover:text-accent-primary/80"
                    >
                      View source <IconExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </RevealItem>
    </PageReveal>
  );
}
