import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconShieldCheck, IconInfoCircle } from "@tabler/icons-react";
import { CONNECTORS, getConnector } from "@/lib/connector-catalog";
import { ConnectorIcon } from "@/components/connections/connector-icon";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";

export function generateStaticParams() {
  return CONNECTORS.map((c) => ({ id: c.id }));
}

export default async function ConnectorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const connector = getConnector(id);
  if (!connector) notFound();

  const ctaDisabled = true; // No TelemetryConnection backend exists yet — honestly disabled, not fabricated.
  const ctaLabel =
    connector.status === "planned" ? "Not available yet" : `Connect ${connector.name} account`;

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

        <div className="flex items-center justify-between mt-6">
          <Link href="/connections" className="text-sm text-content-muted hover:text-content-secondary transition-colors">
            ← Back to all connectors
          </Link>
          <button
            disabled={ctaDisabled}
            title={ctaDisabled ? "Connections aren't wired to a live backend yet" : undefined}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-accent-primary/20 border border-accent-primary/30 opacity-60 cursor-not-allowed"
          >
            {ctaLabel}
          </button>
        </div>

        <p className="text-xs text-content-muted text-center mt-8">
          Not ready yet?{" "}
          <Link href="/" className="text-accent-primary hover:text-accent-primary/80">
            Explore the dashboard with sample data first →
          </Link>
        </p>
      </RevealItem>
    </PageReveal>
  );
}
