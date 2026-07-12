import Link from "next/link";
import { IconChevronRight } from "@tabler/icons-react";
import { CONNECTORS } from "@/lib/connector-catalog";
import { ConnectorIcon } from "@/components/connections/connector-icon";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";

export default function ConnectionsPage() {
  return (
    <PageReveal className="space-y-6 max-w-3xl">
      <RevealItem>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-content-primary">Connect your data</h1>
          <p className="text-sm text-content-muted">
            Every connected source gives Areté real production context — so a review can say
            &quot;this endpoint failed 6 times this week&quot; instead of judging the diff alone.
          </p>
        </div>
      </RevealItem>

      <RevealItem>
        <div className="glass-panel divide-y divide-border-subtle overflow-hidden">
          {CONNECTORS.map((connector) => (
            <Link
              key={connector.id}
              href={`/connections/${connector.id}`}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03] group"
            >
              <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 border border-border-default text-content-secondary shrink-0">
                <ConnectorIcon id={connector.id} className="w-5 h-5" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-content-primary">{connector.name}</span>
                  <span className="text-[10px] font-medium text-content-muted border border-border-subtle rounded-full px-1.5 py-0.5">
                    {connector.category}
                  </span>
                  {connector.status === "planned" && (
                    <span className="text-[10px] font-medium text-accent-info/80 border border-accent-info/20 bg-accent-info/5 rounded-full px-1.5 py-0.5">
                      Planned
                    </span>
                  )}
                </div>
                <p className="text-xs text-content-muted mt-0.5 truncate">{connector.tagline}</p>
              </div>

              <IconChevronRight className="w-4 h-4 text-content-muted shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </RevealItem>

      <RevealItem>
        <p className="text-xs text-content-muted text-center">
          Not ready yet? Every connector is optional — Areté reviews from the diff alone until you connect one.
        </p>
      </RevealItem>
    </PageReveal>
  );
}
