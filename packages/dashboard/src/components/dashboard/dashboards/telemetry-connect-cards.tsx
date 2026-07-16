import Link from "next/link";
import { IconArrowRight, IconShieldLock } from "@tabler/icons-react";
import { CONNECTORS, type ConnectorDef } from "@/lib/connector-catalog";

/**
 * "Connect this service" cards for the Telemetry tab's empty state. Every card is
 * drawn from the real connector catalog (connector-catalog.ts) — name, what it
 * surfaces, how auth works, and the honest trust/requirement note — so the empty
 * state is actionable and truthful rather than a blank skeleton. Nothing here is
 * fabricated: "available" links to the real /connections flow; "planned" is shown
 * as not-yet-connectable, never as a live control.
 */
function ConnectCard({ connector }: { connector: ConnectorDef }) {
  const planned = connector.status === "planned";
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border-default bg-surface-1 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-content-primary">{connector.name}</p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-content-muted">
            {connector.category}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide ${
            planned
              ? "border-border-default bg-content-primary/[0.04] text-content-muted"
              : "border-accent-success/30 bg-accent-success/10 text-accent-success"
          }`}
        >
          {planned ? "Planned" : "Available"}
        </span>
      </div>

      <p className="text-[13px] leading-relaxed text-content-secondary">{connector.tagline}</p>

      <p className="text-[12px] leading-relaxed text-content-muted">{connector.authSummary}</p>

      <div className="flex items-start gap-1.5 rounded-lg border border-border-subtle bg-surface-2/40 px-2.5 py-2">
        <IconShieldLock className="mt-px h-3.5 w-3.5 shrink-0 text-content-muted" stroke={1.6} aria-hidden />
        <p className="text-[11px] leading-relaxed text-content-muted">
          {connector.requirement ? `${connector.requirement} ` : ""}
          {connector.trustNote}
        </p>
      </div>

      {planned ? (
        <span className="mt-auto inline-flex w-fit items-center gap-2 rounded-xl border border-border-default px-3.5 py-2 text-[13px] font-semibold text-content-muted">
          Not yet available
        </span>
      ) : (
        <Link
          href="/connections"
          className="mt-auto inline-flex w-fit items-center gap-2 rounded-xl bg-accent-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-primary/90"
        >
          Connect {connector.name} <IconArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

/** Grid of connect-a-service cards, one per catalog connector. */
export function TelemetryConnectCards() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Connect a telemetry service">
      {CONNECTORS.map((c) => (
        <ConnectCard key={c.id} connector={c} />
      ))}
    </div>
  );
}
