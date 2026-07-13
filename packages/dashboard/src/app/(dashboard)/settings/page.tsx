import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getInstallationBilling, resolveSelectedInstallationIds, FREE_TIER_REVIEW_LIMIT } from "@/lib/queries";
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

export default async function SettingsPage({
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
  const billing = await getInstallationBilling(db, installationIds);

  const userName = session.user.name ?? session.user.email ?? "Signed in";
  const userEmail = session.user.email ?? "";

  return (
    <PageReveal className="max-w-2xl space-y-6">
      <RevealItem>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-content-primary">Settings</h1>
          <p className="text-sm text-content-muted">Your account and billing.</p>
        </div>
      </RevealItem>

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
