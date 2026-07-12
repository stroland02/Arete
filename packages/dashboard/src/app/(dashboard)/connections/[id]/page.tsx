import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { IconArrowLeft, IconShieldCheck, IconInfoCircle } from "@tabler/icons-react";
import { auth } from "@/lib/auth";
import { CONNECTORS, getConnector, type ConnectorDef } from "@/lib/connector-catalog";
import { resolveSelectedInstallationIds } from "@/lib/queries";
import { ConnectorIcon } from "@/components/connections/connector-icon";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { StripeConnectForm } from "@/components/connections/stripe-connect-form";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return CONNECTORS.map((c) => ({ id: c.id }));
}

// The generic OAuth engine (packages/webhook/src/oauth/*) only has provider
// config wired up for these two — see server.ts's GET /oauth/:provider/authorize
// route typing. Sentry is gated behind Sentry's own app-review process;
// Stripe intentionally uses a restricted API key instead of OAuth.
const OAUTH_READY_PROVIDERS = new Set(["posthog", "vercel"]);

function buildConnectHref(connector: ConnectorDef, installationId: string): string | null {
  if (connector.status !== "available" || !OAUTH_READY_PROVIDERS.has(connector.id)) return null;
  const webhookServiceUrl = process.env.WEBHOOK_SERVICE_URL;
  if (!webhookServiceUrl) return null;
  return `${webhookServiceUrl}/oauth/${connector.id}/authorize?installationId=${encodeURIComponent(installationId)}`;
}

export default async function ConnectorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ installation?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;
  const connector = getConnector(id);
  if (!connector) notFound();

  const { installation } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], installation);
  const targetInstallationId = installationIds[0];

  const connectHref = targetInstallationId ? buildConnectHref(connector, targetInstallationId) : null;
  const ctaDisabled = !connectHref;
  const ctaLabel =
    connector.status === "planned"
      ? "Not available yet"
      : !targetInstallationId
        ? "Install the GitHub App first"
        : connectHref
          ? `Connect ${connector.name} account`
          : "Not available yet";

  return (
    <PageReveal className="max-w-2xl">
      <RevealItem>
        <Link
          href="/connections"
          className="inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content-secondary transition-colors mb-6"
        >
          <IconArrowLeft className="w-4 h-4" />
          Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/5 border border-border-default text-content-secondary">
            <ConnectorIcon id={connector.id} className="w-5 h-5" />
          </span>
          <h1 className="text-xl font-semibold text-content-primary">Connect {connector.name}</h1>
        </div>
        <p className="text-sm text-content-muted mb-6">{connector.tagline}</p>

        <div className="glass-panel divide-y divide-border-subtle overflow-hidden">
          <div className="flex items-start gap-3 p-4">
            <IconShieldCheck className="w-4 h-4 text-accent-success mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-content-secondary">{connector.authSummary}</p>
              <p className="text-xs text-content-muted mt-1">{connector.trustNote}</p>
            </div>
          </div>

          {connector.requirement && (
            <div className="flex items-start gap-3 p-4">
              <IconInfoCircle className="w-4 h-4 text-accent-info mt-0.5 shrink-0" />
              <p className="text-xs text-content-secondary">{connector.requirement}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-6 gap-4">
          <Link
            href="/connections"
            className="shrink-0 text-sm text-content-muted hover:text-content-secondary transition-colors"
          >
            ← Back to all connectors
          </Link>

          {connector.authKind === "api-key" && connector.status === "available" && targetInstallationId ? (
            <div className="flex-1 max-w-sm">
              <StripeConnectForm installationId={targetInstallationId} />
            </div>
          ) : connectHref ? (
            <a
              href={connectHref}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-accent-primary hover:bg-accent-primary/90 transition-colors"
            >
              {ctaLabel}
            </a>
          ) : (
            <button
              disabled={ctaDisabled}
              title={ctaDisabled ? "Not connectable yet — see the notes above" : undefined}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-accent-primary/20 border border-accent-primary/30 opacity-60 cursor-not-allowed"
            >
              {ctaLabel}
            </button>
          )}
        </div>

        <p className="text-xs text-content-muted text-center mt-8">
          Not ready yet?{" "}
          <Link href="/overview" className="text-accent-primary hover:text-accent-primary/80">
            Explore the dashboard with sample data first →
          </Link>
        </p>
      </RevealItem>
    </PageReveal>
  );
}
