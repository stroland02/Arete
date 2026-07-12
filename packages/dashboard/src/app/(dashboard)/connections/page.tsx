import Link from "next/link";
import { IconBrandGithub, IconChevronRight } from "@tabler/icons-react";
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
        <div className="glass-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent-primary/20 bg-accent-primary/10 text-accent-primary">
            <IconBrandGithub className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-content-primary">Areté GitHub App</span>
              <span className="rounded-full border border-accent-primary/20 bg-accent-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-accent-primary/80">
                Core
              </span>
            </div>
            <p className="mt-0.5 text-xs text-content-muted">
              Install the Areté GitHub App on your account or org so Areté can review your pull
              requests. This is the core connection that powers your overview dashboard.
            </p>
          </div>
          <a
            href="https://github.com/apps/arete-ai-code-review"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/30"
          >
            <IconBrandGithub className="h-4 w-4" />
            Install on GitHub
          </a>
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
