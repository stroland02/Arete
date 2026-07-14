import { redirect } from "next/navigation";
import { IconBrandGithub, IconCircleCheck, IconAlertTriangle } from "@tabler/icons-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getInstallationBilling, resolveSelectedInstallationIds, FREE_TIER_REVIEW_LIMIT } from "@/lib/queries";
import { isGithubLinked } from "@/lib/github-link";
import { connectGithub } from "./github-link-actions";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function statusBadgeVariant(status: string): "positive" | "negative" | "neutral" {
  if (status === "active") return "positive";
  if (status === "past_due" || status === "canceled") return "negative";
  return "neutral";
}

function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "trialing":
      return "Free tier";
    case "past_due":
      return "Payment past due";
    case "canceled":
      return "Canceled";
    default:
      return status;
  }
}

function githubBanner(connected?: string, error?: string) {
  if (connected === "github") {
    return {
      tone: "positive" as const,
      Icon: IconCircleCheck,
      message: "GitHub connected. Areté can now see the installations you administer.",
    };
  }
  if (error === "github_account_conflict") {
    return {
      tone: "negative" as const,
      Icon: IconAlertTriangle,
      message:
        "That GitHub account is already linked to a different Areté account. Sign in with that account to manage it, or connect a different GitHub account.",
    };
  }
  if (error === "github_link_failed") {
    return {
      tone: "negative" as const,
      Icon: IconAlertTriangle,
      message: "We couldn't connect your GitHub account. Please try again.",
    };
  }
  return null;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string; connected?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { installation, connected, error } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], installation);
  const billing = await getInstallationBilling(db, installationIds);
  const githubLinked = await isGithubLinked(db, session.user.id);
  const banner = githubBanner(connected, error);

  const userName = session.user.name ?? session.user.email ?? "Signed in";
  const userEmail = session.user.email ?? "";

  return (
    <PageReveal className="mx-auto max-w-5xl space-y-6">
      <RevealItem>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-content-primary">Settings</h1>
          <p className="text-sm text-content-muted">Your account and billing.</p>
        </div>
      </RevealItem>

      {banner && (
        <RevealItem>
          <div
            className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
              banner.tone === "positive"
                ? "border-accent-success/20 bg-accent-success/5 text-accent-success"
                : "border-accent-danger/20 bg-accent-danger/5 text-accent-danger"
            }`}
          >
            <banner.Icon className="w-4 h-4 mt-0.5 shrink-0" />
            <p>{banner.message}</p>
          </div>
        </RevealItem>
      )}

      <RevealItem>
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            <SettingRow label="Name" value={userName} />
            {userEmail && <SettingRow label="Email" value={userEmail} mono />}
            {billing && <SettingRow label="Organization" value={billing.owner} mono />}
          </div>
        </Card>
      </RevealItem>

      <RevealItem>
        <Card>
          <CardHeader>
            <CardTitle>GitHub</CardTitle>
            {githubLinked && <Badge variant="positive">Connected</Badge>}
          </CardHeader>

          {githubLinked ? (
            <div className="space-y-3">
              <p className="text-sm text-content-muted">
                Your GitHub account is linked. Areté shows the installations you administer below.
              </p>
              {session.installations.length === 0 ? (
                <p className="text-xs text-content-muted">
                  No installations found for this GitHub account yet — install the Areté GitHub App
                  on an account or org you administer, or ask an org admin to.
                </p>
              ) : (
                <div className="space-y-2">
                  {session.installations.map((i) => (
                    <SettingRow key={i.id} label="Authorized installation" value={i.owner} mono />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-content-muted">
                Connect GitHub so Areté knows which repositories and installations you administer.
                This determines what shows up across your dashboard — nothing is visible until
                you connect an account.
              </p>
              <form action={connectGithub}>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90"
                >
                  <IconBrandGithub className="w-4 h-4" />
                  Connect GitHub
                </button>
              </form>
            </div>
          )}
        </Card>
      </RevealItem>

      <RevealItem>
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
          </CardHeader>

          {!billing ? (
            <p className="text-sm text-content-muted">
              No installation authorized yet — install the Areté GitHub App to see billing here.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-secondary">Subscription status</span>
                <Badge variant={statusBadgeVariant(billing.subscriptionStatus)}>
                  {statusLabel(billing.subscriptionStatus)}
                </Badge>
              </div>

              {billing.subscriptionStatus === "active" ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-content-secondary">Reviews this billing period</span>
                  <span className="text-sm font-mono tabular-nums text-content-primary">{billing.usageCount}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-content-secondary">Free reviews used</span>
                    <span className="font-mono tabular-nums text-content-primary">
                      {billing.usageCount} / {FREE_TIER_REVIEW_LIMIT}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-content-primary/5 border border-border-subtle overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        billing.usageCount >= FREE_TIER_REVIEW_LIMIT ? "bg-accent-danger" : "bg-accent-primary"
                      }`}
                      style={{
                        width: `${Math.min(100, (billing.usageCount / FREE_TIER_REVIEW_LIMIT) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {billing.subscriptionStatus !== "active" && (
                <p className="text-xs text-content-muted pt-2 border-t border-border-subtle">
                  {billing.usageCount >= FREE_TIER_REVIEW_LIMIT
                    ? "You've used all your free reviews. "
                    : `${FREE_TIER_REVIEW_LIMIT - billing.usageCount} free reviews remaining. `}
                  There&apos;s no self-serve upgrade yet — contact the Areté team to move to a paid plan.
                </p>
              )}
            </div>
          )}
        </Card>
      </RevealItem>
    </PageReveal>
  );
}

function SettingRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-content-muted">{label}</span>
      <span className={`text-sm text-content-secondary ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
