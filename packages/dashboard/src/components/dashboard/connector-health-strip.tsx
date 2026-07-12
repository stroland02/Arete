import Link from "next/link";
import { IconArrowRight } from "@tabler/icons-react";
import { CONNECTORS } from "@/lib/connector-catalog";
import { ConnectorIcon } from "@/components/connections/connector-icon";

/**
 * Overview-page nudge into the real /connections page. Reads the shared
 * connector catalog (packages/webhook/src/telemetry/*, see
 * docs/superpowers/specs/2026-07-10-telemetry-connectors-design.md) — no
 * duplicated data, no fabricated "connected" state.
 */
export function ConnectorHealthStrip() {
  const connectedCount = CONNECTORS.filter((c) => c.connected).length;

  return (
    <div className="glass-panel p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-content-primary">
            Enrich every review with your tools
          </h2>
          <p className="text-xs text-content-muted mt-0.5">
            {connectedCount === 0
              ? "Connect a tool and Areté reviews with real production context — not just the diff."
              : `${connectedCount} connected · each one makes reviews sharper.`}
          </p>
        </div>
        <Link
          href="/connections"
          className="flex items-center gap-1.5 text-sm text-accent-primary font-medium hover:text-accent-primary/80 transition-colors"
        >
          Manage <IconArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {CONNECTORS.map((connector) => (
          <Link
            key={connector.id}
            href={`/connections/${connector.id}`}
            className="group flex flex-col gap-3 p-4 rounded-xl border border-border-subtle bg-white/[0.02] text-left transition-colors hover:border-border-default hover:bg-white/[0.04]"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/5 border border-border-default text-content-secondary">
                <ConnectorIcon id={connector.id} className="w-4 h-4" />
              </span>
              {connector.connected ? (
                <span className="flex items-center gap-1 text-[10px] font-medium text-accent-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-success" />
                  Connected
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-content-muted/40" />
              )}
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-medium text-content-secondary">{connector.name}</span>
              <span className="text-xs text-content-muted">{connector.category}</span>
            </div>
            {!connector.connected && (
              <span className="text-xs font-medium text-accent-primary/80 group-hover:text-accent-primary">
                {connector.status === "planned" ? "Learn more →" : "Connect →"}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
